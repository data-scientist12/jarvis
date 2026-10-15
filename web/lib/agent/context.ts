import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getGoogleAuth, getGrantedConnectors } from "@/lib/google/client";
import type { Connector } from "@/lib/auth/scopes";
import type { ToolContext } from "@/lib/tools/types";

export interface Profile {
  timezone: string;
  autopilot: boolean;
  model: string | null;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Ensures a profile row exists (optionally seeding the timezone) and returns it. */
export async function ensureProfile(userId: string, tzHint?: string | null): Promise<Profile> {
  const [existing] = await db.select().from(schema.profile).where(eq(schema.profile.userId, userId)).limit(1);
  if (existing) return { timezone: existing.timezone, autopilot: existing.autopilot, model: existing.model };
  const timezone = isValidTimezone(tzHint) ? tzHint : "Asia/Kolkata";
  await db.insert(schema.profile).values({ userId, timezone }).onConflictDoNothing();
  const [row] = await db.select().from(schema.profile).where(eq(schema.profile.userId, userId)).limit(1);
  return { timezone: row?.timezone ?? timezone, autopilot: row?.autopilot ?? false, model: row?.model ?? null };
}

export interface AgentContext {
  ctx: ToolContext;
  profile: Profile;
  granted: Connector[];
  memories: string[];
}

export async function loadAgentContext(userId: string, tzOverride?: string | null): Promise<AgentContext> {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (!u) throw new Error("User not found");
  const profile = await ensureProfile(userId, tzOverride);
  const [granted, mem] = await Promise.all([
    getGrantedConnectors(userId).catch(() => [] as Connector[]),
    db.select({ fact: schema.memory.fact }).from(schema.memory).where(eq(schema.memory.userId, userId)).orderBy(schema.memory.createdAt).limit(60),
  ]);
  const ctx: ToolContext = {
    userId,
    userName: u.name,
    userEmail: u.email,
    timezone: profile.timezone,
    now: new Date(),
    google: () => getGoogleAuth(userId),
  };
  return { ctx, profile, granted, memories: mem.map((m) => m.fact) };
}
