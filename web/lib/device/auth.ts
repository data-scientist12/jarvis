import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newDeviceToken = () => "jvd_" + randomBytes(24).toString("hex");

/** Authenticates a companion via `Authorization: Bearer jvd_…`; bumps lastSeenAt. */
export async function deviceFromRequest(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token?.startsWith("jvd_")) return null;
  const [dev] = await db.select().from(schema.device).where(eq(schema.device.tokenHash, hashToken(token))).limit(1);
  if (!dev) return null;
  await db.update(schema.device).set({ lastSeenAt: new Date() }).where(eq(schema.device.id, dev.id));
  return dev;
}
