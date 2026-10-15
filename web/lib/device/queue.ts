import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CommandOutcome } from "./executor";

type Command = typeof schema.deviceCommand.$inferSelect;

/** Queue a command for a device executor and wait for its outcome. */
export async function runOnDevice(
  userId: string,
  type: string,
  payload: Record<string, unknown>,
  opts: { pickupMs?: number; totalMs?: number } = {},
): Promise<CommandOutcome> {
  const pickupMs = opts.pickupMs ?? 6_000;
  const totalMs = opts.totalMs ?? 40_000;
  const [cmd] = await db.insert(schema.deviceCommand).values({ userId, type, payload }).returning({ id: schema.deviceCommand.id });
  const started = Date.now();

  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [row] = await db.select().from(schema.deviceCommand).where(eq(schema.deviceCommand.id, cmd.id)).limit(1);
    if (!row) return { ok: false, summary: "Command vanished", error: "upstream_error" };

    if (row.status === "done" || row.status === "failed") {
      const result = (row.result ?? {}) as unknown as CommandOutcome;
      return row.status === "done" && result.summary ? result : { ok: false, summary: row.error ?? "Device command failed", error: "upstream_error" };
    }
    const waited = Date.now() - started;
    if (row.status === "pending" && waited > pickupMs) {
      await db.update(schema.deviceCommand).set({ status: "expired", completedAt: new Date() })
        .where(and(eq(schema.deviceCommand.id, cmd.id), eq(schema.deviceCommand.status, "pending")));
      return {
        ok: false,
        summary: "Your Mac isn't connected to Jarvis",
        error: "device_offline",
        suggestion: "Ask the user to connect their Mac: Settings → Mac companion, then run the one-line command shown there.",
      };
    }
    if (waited > totalMs) {
      await db.update(schema.deviceCommand).set({ status: "expired", completedAt: new Date() }).where(eq(schema.deviceCommand.id, cmd.id));
      return { ok: false, summary: "The Mac took too long to respond", error: "upstream_error", suggestion: "Try again in a moment." };
    }
  }
}

/** Atomically claim pending commands. `userId` null = any user (the dev server's own local executor). */
export async function claimPending(opts: { userId?: string; deviceId?: string; limit?: number }): Promise<Command[]> {
  const limit = opts.limit ?? 5;
  const rows = await db.execute(sql`
    UPDATE device_command SET status = 'running', claimed_at = now(), device_id = ${opts.deviceId ?? null}
    WHERE id IN (
      SELECT id FROM device_command
      WHERE status = 'pending' AND created_at > now() - interval '2 minutes'
        ${opts.userId ? sql`AND user_id = ${opts.userId}` : sql``}
      ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED
    ) RETURNING id, user_id AS "userId", type, payload`);
  return rows.rows as unknown as Command[];
}

export async function completeCommand(id: string, outcome: CommandOutcome, filter?: { deviceId?: string }) {
  await db.update(schema.deviceCommand)
    .set({ status: outcome.ok ? "done" : "failed", result: outcome as unknown as Record<string, unknown>, error: outcome.ok ? null : outcome.summary, completedAt: new Date() })
    .where(and(eq(schema.deviceCommand.id, id), filter?.deviceId ? eq(schema.deviceCommand.deviceId, filter.deviceId) : sql`true`));
}
