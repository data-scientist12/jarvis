import { generateText, Output } from "ai";
import { z } from "zod";
import { lowEffort, reviewModel } from "@/lib/agent/models";
import { formatLocalNow } from "@/lib/agent/system-prompt";
import { assertValidTrigger, MAX_GMAIL_EVERY_MINUTES, MIN_GMAIL_EVERY_MINUTES, type Trigger } from "@/lib/automations/schedule";

export interface AutomationSpec {
  name: string;
  trigger: Trigger;
  instructions: string;
  usage: { inputTokens: number; outputTokens: number };
}

// Flat schema (nullable instead of unions) so it works with strict structured outputs.
const specSchema = z.object({
  name: z.string().describe("Short title, max 6 words."),
  triggerType: z.enum(["schedule", "gmail", "manual"]),
  cron: z.string().nullable().describe("5-field cron expression in the user's timezone when triggerType=schedule, else null."),
  gmailQuery: z.string().nullable().describe("Gmail search query when triggerType=gmail, else null."),
  everyMinutes: z.number().nullable().describe("Polling interval in minutes (5-1440) when triggerType=gmail, else null."),
  instructions: z.string().describe("A complete, self-contained task description for an autonomous agent that has Gmail, Calendar, Meet, Drive/Docs/Sheets, Tasks and Contacts tools. It must not depend on the original request. Include concrete steps, search queries, naming conventions, what to skip, what to report, and that it runs unattended (never ask questions)."),
});

const PARSE_INSTRUCTIONS = `You convert a plain-English automation request into a structured spec for a personal AI agent.
Choose the trigger:
- "schedule" for time-based requests ("every weekday at 8", "Fridays 5pm", "daily"). Output a standard 5-field cron (minute hour day-of-month month day-of-week) interpreted in the user's timezone. Never fire more often than every 10 minutes.
- "gmail" when the request reacts to incoming email ("whenever I get an invoice", "when someone emails about X"). Provide a precise Gmail search query and everyMinutes (default 15).
- "manual" only if no trigger is implied (run on demand).
Write "instructions" so another agent can execute it later with no other context. Use relative dates ("today", "this week") instead of fixed dates. Prefer creating drafts over sending email to other people unless the request clearly says to send; emails to the user themselves may be sent. Keep it under 250 words.`;

export async function parseAutomation(args: { prompt: string; timezone: string; now?: Date }): Promise<AutomationSpec> {
  const now = args.now ?? new Date();
  const res = await generateText({
    model: reviewModel(),
    instructions: PARSE_INSTRUCTIONS,
    prompt: `User timezone: ${args.timezone}\nCurrent time: ${formatLocalNow(now, args.timezone)}\n\nRequest:\n${args.prompt.slice(0, 3000)}`,
    output: Output.object({ schema: specSchema }),
    providerOptions: lowEffort,
    abortSignal: AbortSignal.timeout(45_000),
    maxRetries: 1,
  });
  const o = res.output;
  const usage = { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 };

  let trigger: Trigger;
  if (o.triggerType === "schedule") {
    if (!o.cron) throw new Error("Could not work out a schedule from that request. Try saying when it should run, e.g. 'every weekday at 8am'.");
    trigger = { type: "schedule", cron: o.cron.trim(), timezone: args.timezone };
  } else if (o.triggerType === "gmail") {
    if (!o.gmailQuery) throw new Error("Could not work out which emails should trigger this.");
    const every = Math.min(MAX_GMAIL_EVERY_MINUTES, Math.max(MIN_GMAIL_EVERY_MINUTES, Math.round(o.everyMinutes ?? 15)));
    trigger = { type: "gmail", query: o.gmailQuery.trim(), everyMinutes: every };
  } else {
    trigger = { type: "manual" };
  }
  assertValidTrigger(trigger);

  return { name: o.name.trim().slice(0, 80) || "Automation", trigger, instructions: o.instructions.trim(), usage };
}
