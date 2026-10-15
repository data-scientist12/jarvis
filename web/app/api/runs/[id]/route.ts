import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getRunForUser } from "@/lib/agent/run";
import { authed, isUuid, json, jsonError } from "@/lib/security/http";


export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await authed();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(404, "not_found");
  const run = await getRunForUser(user.id, id);
  if (!run) return jsonError(404, "not_found");
  const steps = await db.select({
    id: schema.runStep.id,
    tool: schema.runStep.tool,
    title: schema.runStep.title,
    status: schema.runStep.status,
    verified: schema.runStep.verified,
    evidence: schema.runStep.evidence,
    input: schema.runStep.input,
    output: schema.runStep.output,
    durationMs: schema.runStep.durationMs,
    createdAt: schema.runStep.createdAt,
  }).from(schema.runStep).where(eq(schema.runStep.runId, id)).orderBy(asc(schema.runStep.createdAt));
  return json({
    run: {
      id: run.id, source: run.source, goal: run.goal, status: run.status, review: run.review, finalText: run.finalText,
      conversationId: run.conversationId, automationId: run.automationId, startedAt: run.startedAt, finishedAt: run.finishedAt,
      inputTokens: run.inputTokens, outputTokens: run.outputTokens,
    },
    steps,
  });
}
