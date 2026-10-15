import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensureProfile } from "@/lib/agent/context";
import { dayBounds } from "@/lib/agent/brief";
import { allJarvisTools } from "@/lib/agent/registry";
import { authed, json } from "@/lib/security/http";


export async function GET() {
  const user = await authed();
  if (user instanceof Response) return user;
  const profile = await ensureProfile(user.id);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const { start: todayStart } = dayBounds(now, profile.timezone);

  const done = inArray(schema.run.status, ["succeeded", "partial"]);
  const [[today], [week], [verified], perTool, [active]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.run)
      .where(and(eq(schema.run.userId, user.id), done, gte(schema.run.startedAt, todayStart))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.run)
      .where(and(eq(schema.run.userId, user.id), done, gte(schema.run.startedAt, weekAgo))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.runStep)
      .innerJoin(schema.run, eq(schema.run.id, schema.runStep.runId))
      .where(and(eq(schema.run.userId, user.id), eq(schema.runStep.verified, true), gte(schema.runStep.createdAt, weekAgo))),
    db.select({ tool: schema.runStep.tool, n: sql<number>`count(*)::int` }).from(schema.runStep)
      .innerJoin(schema.run, eq(schema.run.id, schema.runStep.runId))
      .where(and(eq(schema.run.userId, user.id), gte(schema.runStep.createdAt, weekAgo), inArray(schema.runStep.status, ["verified", "done"])))
      .groupBy(schema.runStep.tool),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.automation)
      .where(and(eq(schema.automation.userId, user.id), eq(schema.automation.enabled, true))),
  ]);

  const risk = new Map(allJarvisTools.map((t) => [t.name, t.risk]));
  let minutes = 0;
  for (const r of perTool) minutes += r.n * (risk.get(r.tool) === "read" ? 0.5 : 2);

  return json({
    tasksCompletedToday: today?.n ?? 0,
    tasksCompletedWeek: week?.n ?? 0,
    actionsVerifiedWeek: verified?.n ?? 0,
    minutesSavedWeek: Math.round(minutes),
    automationsActive: active?.n ?? 0,
  });
}
