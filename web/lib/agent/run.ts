import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type RunStatus = "running" | "succeeded" | "partial" | "failed" | "needs_input";
export type FinalStatus = Exclude<RunStatus, "running">;
export type RunSource = "chat" | "automation" | "brief";

export interface Review {
  status: FinalStatus;
  summary: string;
  missing: string[];
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export async function createRun(args: {
  userId: string;
  source: RunSource;
  goal: string;
  conversationId?: string | null;
  automationId?: string | null;
}): Promise<string> {
  const [row] = await db.insert(schema.run).values({
    userId: args.userId,
    source: args.source,
    goal: args.goal.slice(0, 4000),
    conversationId: args.conversationId ?? null,
    automationId: args.automationId ?? null,
    status: "running",
  }).returning({ id: schema.run.id });
  return row.id;
}

export async function finishRun(
  id: string,
  args: { status: FinalStatus; review?: Review | null; finalText?: string | null; usage?: Usage },
): Promise<void> {
  await db.update(schema.run).set({
    status: args.status,
    review: args.review ? ({ ...args.review, complete: args.review.status === "succeeded" } as Record<string, unknown>) : null,
    finalText: args.finalText ?? null,
    // Increment so a run resumed after an approval accumulates usage across segments.
    inputTokens: sql`${schema.run.inputTokens} + ${args.usage?.inputTokens ?? 0}`,
    outputTokens: sql`${schema.run.outputTokens} + ${args.usage?.outputTokens ?? 0}`,
    finishedAt: new Date(),
  }).where(eq(schema.run.id, id));
}

export async function recordUsage(userId: string, model: string, usage: Usage): Promise<void> {
  if (!usage.inputTokens && !usage.outputTokens) return;
  try {
    await db.insert(schema.usageEvent).values({ userId, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
  } catch (e) {
    console.warn("[usage] insert failed:", e instanceof Error ? e.message : e);
  }
}

export interface StepRow {
  tool: string;
  title: string;
  status: "running" | "verified" | "done" | "failed";
  verified: boolean | null;
  evidence: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
}

export async function getRunSteps(runId: string): Promise<StepRow[]> {
  const rows = await db.select({
    tool: schema.runStep.tool,
    title: schema.runStep.title,
    status: schema.runStep.status,
    verified: schema.runStep.verified,
    evidence: schema.runStep.evidence,
    input: schema.runStep.input,
    output: schema.runStep.output,
    createdAt: schema.runStep.createdAt,
  }).from(schema.runStep).where(eq(schema.runStep.runId, runId)).orderBy(schema.runStep.createdAt);
  return rows;
}

/** Ownership-checked run lookup. */
export async function getRunForUser(userId: string, runId: string) {
  const [row] = await db.select().from(schema.run).where(and(eq(schema.run.id, runId), eq(schema.run.userId, userId))).limit(1);
  return row ?? null;
}
