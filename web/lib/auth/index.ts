import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { APIError } from "better-auth/api";
import { db, schema } from "@/lib/db";
import { ALL_GOOGLE_SCOPES } from "./scopes";

const allowed = (process.env.ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "Jarvis",
  trustedOrigins: [process.env.BETTER_AUTH_URL, ...(process.env.TRUSTED_ORIGINS ?? "").split(",")].map((o) => o?.trim()).filter((o): o is string => Boolean(o)),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
  socialProviders: googleConfigured
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          accessType: "offline",
          prompt: "select_account consent",
          scope: ALL_GOOGLE_SCOPES,
        },
      }
    : {},
  account: {
    // Google access/refresh tokens are encrypted at rest with BETTER_AUTH_SECRET.
    encryptOAuthTokens: true,
    updateAccountOnSignIn: true,
    accountLinking: { enabled: true, trustedProviders: ["google"], allowDifferentEmails: true },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  rateLimit: { enabled: true, window: 60, max: 30 },
  databaseHooks: {
    user: {
      create: {
        before: async (u) => {
          // Production fails closed: with no ALLOWED_EMAILS nobody can sign up (protects the OpenAI key).
          const closed = process.env.NODE_ENV === "production" && allowed.length === 0;
          if (closed || (allowed.length && !allowed.includes(u.email.toLowerCase()))) {
            throw new APIError("FORBIDDEN", { message: "This email is not on the Jarvis access list." });
          }
          return { data: u };
        },
      },
    },
  },
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
