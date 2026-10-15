import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { authed, json, jsonError } from "@/lib/security/http";


const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  source: z.enum(["chat", "automation", "brief"]).optional(),
});

export async function GET(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const sp = new URL(req.url).searchParams;
  const q = querySchema.safeParse({ limit: sp.get("limit") ?? undefined, source: sp.get("source") || undefined });
  if (!q.success) return jsonError(400, "invalid_query");

  const rows = await db.select({
    id: schema.run.id,
    source: schema.run.source,
    goal: schema.run.goal,
    status: schema.run.status,
    startedAt: schema.run.startedAt,
    finishedAt: schema.run.finishedAt,
    review: schema.run.review,
    stepCount: sql<number>`(select count(*) from run_step where run_step.run_id = ${schema.run.id})::int`,
    verifiedCount: sql<number>`(select count(*) from run_step where run_step.run_id = ${schema.run.id} and run_step.verified = true)::int`,
  }).from(schema.run)
    .where(and(eq(schema.run.userId, user.id), q.data.source ? eq(schema.run.source, q.data.source) : undefined))
    .orderBy(desc(schema.run.startedAt)).limit(q.data.limit);
  return json({ runs: rows });
}
