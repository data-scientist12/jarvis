import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensureProfile } from "@/lib/agent/context";
import { recordUsage } from "@/lib/agent/run";
import { parseAutomation } from "@/lib/automations/parse";
import { computeNextRun, type Trigger } from "@/lib/automations/schedule";
import { serializeAutomation } from "@/lib/automations/serialize";
import { isOverBudget, budgetExceededResponse } from "@/lib/security/budget";
import { authed, json, jsonError, readJson } from "@/lib/security/http";
import { enforce, LIMITS } from "@/lib/security/ratelimit";

export const maxDuration = 60;

const MAX_AUTOMATIONS = 30;

export async function GET() {
  const user = await authed();
  if (user instanceof Response) return user;
  const rows = await db.select().from(schema.automation).where(eq(schema.automation.userId, user.id)).orderBy(desc(schema.automation.createdAt));
  return json({ automations: rows.map(serializeAutomation) });
}

const createSchema = z.object({ prompt: z.string().trim().min(3).max(3000), timezone: z.string().max(64).optional() });

export async function POST(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const limited = await enforce(user.id, [LIMITS.automationCreate]);
  if (limited) return limited;
  const body = await readJson(req, createSchema);
  if (body instanceof Response) return body;
  if (await isOverBudget(user.id)) return budgetExceededResponse();

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.automation).where(eq(schema.automation.userId, user.id));
  if (n >= MAX_AUTOMATIONS) return jsonError(409, "too_many_automations", { message: `You can have up to ${MAX_AUTOMATIONS} automations.` });

  const profile = await ensureProfile(user.id, body.timezone);
  let spec;
  try {
    spec = await parseAutomation({ prompt: body.prompt, timezone: profile.timezone });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not understand that automation.";
    console.warn("[automations] parse failed:", message);
    return jsonError(422, "could_not_parse", { message: message.slice(0, 300) });
  }
  await recordUsage(user.id, "review", spec.usage);

  const [row] = await db.insert(schema.automation).values({
    userId: user.id,
    name: spec.name,
    trigger: spec.trigger as unknown as Record<string, unknown>,
    instructions: spec.instructions,
    enabled: true,
    nextRunAt: computeNextRun(spec.trigger as Trigger, new Date()),
  }).returning();
  return json({ automation: serializeAutomation(row) }, { status: 201 });
}
