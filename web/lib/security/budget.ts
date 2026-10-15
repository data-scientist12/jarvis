import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export function dailyTokenBudget(): number {
  const n = Number(process.env.DAILY_TOKEN_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
}

/** Tokens (input + output) the user has consumed in the last 24 hours. */
export async function tokensUsedToday(userId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.usageEvent.inputTokens} + ${schema.usageEvent.outputTokens}), 0)::int` })
    .from(schema.usageEvent)
    .where(and(eq(schema.usageEvent.userId, userId), gte(schema.usageEvent.createdAt, since)));
  return Number(row?.total ?? 0);
}

export async function isOverBudget(userId: string): Promise<boolean> {
  return (await tokensUsedToday(userId)) >= dailyTokenBudget();
}

export function budgetExceededResponse(): Response {
  return new Response(JSON.stringify({ error: "budget_exceeded", message: "Daily usage limit reached. Try again tomorrow." }), {
    status: 429,
    headers: { "content-type": "application/json" },
  });
}
