import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { assertValidTrigger, computeNextRun, triggerSchema, type Trigger } from "@/lib/automations/schedule";
import { serializeAutomation } from "@/lib/automations/serialize";
import { authed, isUuid, json, jsonError, readJson } from "@/lib/security/http";


const patchSchema = z.object({
  enabled: z.boolean().optional(),
  name: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().trim().min(3).max(6000).optional(),
  trigger: triggerSchema.optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found");
  const body = await readJson(req, patchSchema);
  if (body instanceof Response) return body;

  const [row] = await db.select().from(schema.automation).where(and(eq(schema.automation.id, id), eq(schema.automation.userId, user.id))).limit(1);
  if (!row) return jsonError(404, "not_found");

  const patch: Partial<typeof schema.automation.$inferInsert> = { updatedAt: new Date() };
  if (body.name !== undefined) patch.name = body.name;
  if (body.instructions !== undefined) patch.instructions = body.instructions;

  let trigger = row.trigger as unknown as Trigger;
  if (body.trigger) {
    try {
      assertValidTrigger(body.trigger);
    } catch (e) {
      return jsonError(422, "invalid_trigger", { message: e instanceof Error ? e.message : "Invalid trigger" });
    }
    trigger = body.trigger;
    patch.trigger = body.trigger as unknown as Record<string, unknown>;
    patch.state = {};
  }
  const enabled = body.enabled ?? row.enabled;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.trigger || (body.enabled === true && !row.enabled)) {
    patch.nextRunAt = enabled ? computeNextRun(trigger, new Date()) : null;
  } else if (body.enabled === false) {
    patch.nextRunAt = null;
  }

  const [updated] = await db.update(schema.automation).set(patch)
    .where(and(eq(schema.automation.id, id), eq(schema.automation.userId, user.id))).returning();
  return json({ automation: serializeAutomation(updated) });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found");
  await db.delete(schema.automation).where(and(eq(schema.automation.id, id), eq(schema.automation.userId, user.id)));
  return json({ ok: true });
}
