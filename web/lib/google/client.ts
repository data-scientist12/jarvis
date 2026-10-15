import "server-only";
import { google } from "googleapis";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { grantedConnectors, type Connector } from "@/lib/auth/scopes";

export class GoogleNotConnectedError extends Error {
  code = "google_not_connected" as const;
  constructor(msg = "Google account is not connected. Connect it on the Connectors page.") { super(msg); }
}

/** The user's Google account row (tokens are encrypted; use getGoogleAuth for a usable client). */
export async function getGoogleAccount(userId: string) {
  const [row] = await db.select().from(schema.account)
    .where(and(eq(schema.account.userId, userId), eq(schema.account.providerId, "google")))
    .limit(1);
  return row ?? null;
}

export async function getGrantedConnectors(userId: string): Promise<Connector[]> {
  const acc = await getGoogleAccount(userId);
  return acc ? grantedConnectors(acc.scope) : [];
}

/**
 * Returns an authenticated OAuth2 client for the user's Google account.
 * Better Auth decrypts and refreshes the access token when it is expired.
 */
export async function getGoogleAuth(userId: string) {
  const acc = await getGoogleAccount(userId);
  if (!acc) throw new GoogleNotConnectedError();
  const { accessToken } = await auth.api.getAccessToken({ body: { accountId: acc.id, userId } });
  if (!accessToken) throw new GoogleNotConnectedError("Google token could not be refreshed. Reconnect Google.");
  const client = new google.auth.OAuth2();
  client.setCredentials({ access_token: accessToken });
  return client;
}
