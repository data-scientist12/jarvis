import { CronExpressionParser } from "cron-parser";
import { z } from "zod";

export const MIN_CRON_GAP_MINUTES = 10;
export const MIN_GMAIL_EVERY_MINUTES = 5;
export const MAX_GMAIL_EVERY_MINUTES = 24 * 60;

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("schedule"),
    cron: z.string().min(5).max(100),
    timezone: z.string().min(1).max(64).refine(validTz, "Invalid timezone"),
  }),
  z.object({
    type: z.literal("gmail"),
    query: z.string().min(1).max(500),
    everyMinutes: z.number().int().min(MIN_GMAIL_EVERY_MINUTES).max(MAX_GMAIL_EVERY_MINUTES),
  }),
  z.object({ type: z.literal("manual") }),
]);

export type Trigger = z.infer<typeof triggerSchema>;

/** Throws a readable Error if the cron is invalid or fires too often. */
export function assertValidTrigger(trigger: Trigger): void {
  if (trigger.type !== "schedule") return;
  let it;
  try {
    it = CronExpressionParser.parse(trigger.cron, { tz: trigger.timezone, currentDate: new Date() });
  } catch (e) {
    throw new Error(`Invalid schedule "${trigger.cron}": ${e instanceof Error ? e.message : "parse error"}`);
  }
  const a = it.next().toDate().getTime();
  const b = it.next().toDate().getTime();
  if ((b - a) / 60000 < MIN_CRON_GAP_MINUTES) {
    throw new Error(`Schedules can't run more often than every ${MIN_CRON_GAP_MINUTES} minutes.`);
  }
}

/** When the automation should next fire after `from`; null for manual triggers. */
export function computeNextRun(trigger: Trigger | Record<string, unknown>, from: Date = new Date()): Date | null {
  const t = trigger as Trigger;
  if (t.type === "schedule") {
    try {
      return CronExpressionParser.parse(t.cron, { tz: t.timezone, currentDate: from }).next().toDate();
    } catch {
      return null;
    }
  }
  if (t.type === "gmail") {
    return new Date(from.getTime() + t.everyMinutes * 60_000);
  }
  return null;
}

export function describeTrigger(trigger: Trigger | Record<string, unknown>): string {
  const t = trigger as Trigger;
  if (t.type === "schedule") return `Schedule ${t.cron} (${t.timezone})`;
  if (t.type === "gmail") return `New email matching "${t.query}" (checked every ${t.everyMinutes} min)`;
  return "Manual";
}
