import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createRun } from "@/lib/agent/run";
import { runAutomation } from "@/lib/automations/runner";
import { budgetExceededResponse, isOverBudget } from "@/lib/security/budget";
import { authed, isUuid, json, jsonError } from "@/lib/security/http";
import { enforce, LIMITS } from "@/lib/security/ratelimit";

export const maxDuration = 300;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found");

  const limited = await enforce(user.id, [LIMITS.automationRun]);
  if (limited) return limited;
  if (await isOverBudget(user.id)) return budgetExceededResponse();

  const [row] = await db.select().from(schema.automation).where(and(eq(schema.automation.id, id), eq(schema.automation.userId, user.id))).limit(1);
  if (!row) return jsonError(404, "not_found");

  const runId = await createRun({ userId: user.id, source: "automation", goal: `Automation: ${row.name}`, automationId: row.id });
  after(async () => {
    await runAutomation(row, { runId, manual: true });
  });
  return json({ runId });
}
