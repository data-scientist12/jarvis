import { google } from "googleapis";
import { and, asc, eq, lte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getGoogleAuth, GoogleNotConnectedError } from "@/lib/google/client";
import { runHeadless } from "@/lib/agent/engine";
import { createRun, finishRun, type FinalStatus } from "@/lib/agent/run";
import { isOverBudget } from "@/lib/security/budget";
import { computeNextRun, type Trigger } from "@/lib/automations/schedule";

export type AutomationRow = typeof schema.automation.$inferSelect;

interface GmailState {
  lastCheckedAt?: string;
  seenIds?: string[];
}

interface FoundMessage {
  id: string;
  from: string;
  subject: string;
}

const MAX_SEEN = 300;
const MAX_MESSAGES_IN_GOAL = 10;

async function findNewMessages(userId: string, query: string, state: GmailState, force: boolean): Promise<FoundMessage[]> {
  const auth = await getGoogleAuth(userId);
  const gmail = google.gmail({ version: "v1", auth });
  const sinceMs = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : NaN;
  // Gmail's `after:` takes epoch seconds. Overlap by 5 minutes; seenIds de-duplicates.
  const afterClause = !force && Number.isFinite(sinceMs) ? `after:${Math.floor(sinceMs / 1000) - 300}` : "newer_than:2d";
  const list = await gmail.users.messages.list({ userId: "me", q: `${query} ${afterClause}`, maxResults: 25 });
  const seen = new Set(state.seenIds ?? []);
  const ids = (list.data.messages ?? []).map((m) => m.id!).filter((id) => id && (force || !seen.has(id)));
  const out: FoundMessage[] = [];
  for (const id of ids.slice(0, MAX_MESSAGES_IN_GOAL)) {
    try {
      const m = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "Subject"] });
      const h = (n: string) => m.data.payload?.headers?.find((x) => x.name?.toLowerCase() === n)?.value ?? "";
      out.push({ id, from: h("from"), subject: h("subject") });
    } catch {
      out.push({ id, from: "", subject: "" });
    }
  }
  return out;
}

export interface AutomationRunOutcome {
  runId: string | null;
  status: FinalStatus | "skipped";
}

/**
 * Executes one automation. `opts.runId` = a run row created earlier (manual "Run now").
 * Scheduled ticks claim the row (and advance nextRunAt) before calling this, so it never touches nextRunAt
 * unless `opts.advance` is set.
 */
export async function runAutomation(
  automation: AutomationRow,
  opts: { runId?: string; manual?: boolean } = {},
): Promise<AutomationRunOutcome> {
  const trigger = automation.trigger as unknown as Trigger;
  const state = (automation.state ?? {}) as GmailState;
  const manual = Boolean(opts.manual);
  let goal = `Automation "${automation.name}"${manual ? " (run manually by the user)" : ""}.\n\n${automation.instructions}`;
  let newState: Record<string, unknown> | null = null;

  const record = async (patch: { lastStatus: string; state?: Record<string, unknown> | null; ranAt?: boolean }) => {
    await db.update(schema.automation).set({
      lastStatus: patch.lastStatus,
      ...(patch.ranAt === false ? {} : { lastRunAt: new Date() }),
      ...(patch.state ? { state: patch.state } : {}),
      updatedAt: new Date(),
    }).where(eq(schema.automation.id, automation.id));
  };

  try {
    if (await isOverBudget(automation.userId)) {
      const runId = opts.runId ?? (await createRun({ userId: automation.userId, source: "automation", goal, automationId: automation.id }));
      await finishRun(runId, { status: "failed", review: { status: "failed", summary: "Daily usage limit reached; will retry on the next run.", missing: [] } });
      await record({ lastStatus: "failed" });
      return { runId, status: "failed" };
    }

    let seenForState: string[] | null = null;
    if (trigger.type === "gmail") {
      let found: FoundMessage[];
      try {
        found = await findNewMessages(automation.userId, trigger.query, state, manual);
      } catch (e) {
        const msg = e instanceof GoogleNotConnectedError ? "Google isn't connected." : `Couldn't check Gmail: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`;
        const runId = opts.runId ?? (await createRun({ userId: automation.userId, source: "automation", goal, automationId: automation.id }));
        await finishRun(runId, { status: "failed", review: { status: "failed", summary: msg, missing: [] } });
        await record({ lastStatus: "failed" });
        return { runId, status: "failed" };
      }
      const nowIso = new Date().toISOString();
      if (!found.length) {
        // Nothing new: don't spend tokens.
        if (opts.runId) {
          await finishRun(opts.runId, { status: "succeeded", review: { status: "succeeded", summary: "No matching emails to process.", missing: [] }, finalText: "No matching emails." });
        }
        await record({ lastStatus: "skipped", ranAt: false, state: { ...state, lastCheckedAt: nowIso } });
        return { runId: opts.runId ?? null, status: "skipped" };
      }
      goal += `\n\nNew matching emails to process (Gmail message ids):\n${found.map((m) => `- id=${m.id} | from: ${m.from || "?"} | subject: ${m.subject || "(no subject)"}`).join("\n")}`;
      seenForState = [...(state.seenIds ?? []), ...found.map((m) => m.id)].slice(-MAX_SEEN);
      newState = { lastCheckedAt: nowIso, seenIds: seenForState };
    }

    const result = await runHeadless({ userId: automation.userId, goal, source: "automation", automationId: automation.id, runId: opts.runId });
    await record({ lastStatus: result.status, state: newState });
    return { runId: result.runId, status: result.status };
  } catch (e) {
    console.error(`[automation ${automation.id}] failed:`, e instanceof Error ? e.message : e);
    await record({ lastStatus: "failed" }).catch(() => {});
    return { runId: opts.runId ?? null, status: "failed" };
  }
}

/**
 * Atomically claims a due automation by advancing nextRunAt (only one caller wins the UPDATE).
 * Returns the row as it was before the claim, or null if someone else got it.
 */
async function claim(row: AutomationRow): Promise<AutomationRow | null> {
  if (!row.nextRunAt) return null;
  const next = computeNextRun(row.trigger, new Date());
  const updated = await db.update(schema.automation)
    .set({ nextRunAt: next, updatedAt: new Date() })
    .where(and(eq(schema.automation.id, row.id), eq(schema.automation.enabled, true), eq(schema.automation.nextRunAt, row.nextRunAt)))
    .returning({ id: schema.automation.id });
  return updated.length ? row : null;
}

export interface TickResult {
  id: string;
  name: string;
  status: AutomationRunOutcome["status"];
}

/** Runs every enabled automation whose nextRunAt has passed (max 10, sequentially, ~4 min budget). */
export async function tickDueAutomations(timeBudgetMs = 240_000): Promise<TickResult[]> {
  const started = Date.now();
  const due = await db.select().from(schema.automation)
    .where(and(eq(schema.automation.enabled, true), lte(schema.automation.nextRunAt, new Date())))
    .orderBy(asc(schema.automation.nextRunAt))
    .limit(10);
  const results: TickResult[] = [];
  for (const row of due) {
    if (Date.now() - started > timeBudgetMs) break;
    const claimed = await claim(row);
    if (!claimed) continue;
    const outcome = await runAutomation(claimed);
    results.push({ id: claimed.id, name: claimed.name, status: outcome.status });
  }
  return results;
}
