import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireApiSession } from "@/lib/auth/session";
import { hashToken, newDeviceToken } from "@/lib/device/auth";

/** GET: list paired devices. POST: pair a new Mac and return its token (shown once). DELETE ?id=: unpair. */
export async function GET() {
  const s = await requireApiSession();
  if (s instanceof Response) return s;
  const rows = await db.select({ id: schema.device.id, name: schema.device.name, lastSeenAt: schema.device.lastSeenAt, createdAt: schema.device.createdAt })
    .from(schema.device).where(eq(schema.device.userId, s.user.id));
  const now = Date.now();
  return Response.json({
    // In development the server itself acts as this Mac's executor.
    localExecutor: process.env.NODE_ENV === "development" && process.env.JARVIS_LOCAL_EXECUTOR !== "0",
    devices: rows.map((d) => ({ ...d, online: !!d.lastSeenAt && now - d.lastSeenAt.getTime() < 45_000 })),
  });
}

export async function POST(req: Request) {
  const s = await requireApiSession();
  if (s instanceof Response) return s;
  const body = z.object({ name: z.string().trim().min(1).max(60).default("My Mac") }).safeParse(await req.json().catch(() => ({})));
  const name = body.success ? body.data.name : "My Mac";
  const existing = await db.select({ id: schema.device.id }).from(schema.device).where(eq(schema.device.userId, s.user.id));
  if (existing.length >= 5) return Response.json({ error: "Too many devices. Remove one first." }, { status: 400 });
  const token = newDeviceToken();
  const [dev] = await db.insert(schema.device).values({ userId: s.user.id, name, tokenHash: hashToken(token) }).returning({ id: schema.device.id });
  return Response.json({ id: dev.id, token });
}

export async function DELETE(req: Request) {
  const s = await requireApiSession();
  if (s instanceof Response) return s;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await db.delete(schema.device).where(and(eq(schema.device.id, id), eq(schema.device.userId, s.user.id)));
  return Response.json({ ok: true });
}
