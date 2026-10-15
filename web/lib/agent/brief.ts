import { generateText, Output } from "ai";
import { google } from "googleapis";
import { z } from "zod";
import { loadAgentContext } from "@/lib/agent/context";
import { executorModel, executorModelId, lowEffort } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/run";
import { formatLocalNow } from "@/lib/agent/system-prompt";
import { getGoogleAccount, getGoogleAuth } from "@/lib/google/client";

export interface Brief {
  greeting: string;
  summary: string;
  connected: boolean;
  events: { id: string; title: string; start: string; end: string; meetLink?: string; htmlLink?: string }[];
  emails: { id: string; threadId: string; from: string; subject: string; snippet: string; date: string; unread: boolean }[];
  tasks: { id: string; title: string; due?: string }[];
  generatedAt: string;
}

const TTL_MS = 10 * 60 * 1000;
const g = globalThis as unknown as { __jarvisBriefCache?: Map<string, { at: number; brief: Brief }> };
const cache = (g.__jarvisBriefCache ??= new Map());

function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Start (inclusive) and end (exclusive) of "today" in the given timezone. */
export function dayBounds(now: Date, tz: string): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  const midnightUtcGuess = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const toInstant = (utcGuess: number) => {
    let t = utcGuess - tzOffsetMs(new Date(utcGuess), tz);
    t = utcGuess - tzOffsetMs(new Date(t), tz);
    return new Date(t);
  };
  return { start: toInstant(midnightUtcGuess), end: toInstant(midnightUtcGuess + 24 * 3600 * 1000) };
}

function timeOfDayGreeting(now: Date, tz: string, name: string): string {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
  const part = hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name}.`;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function getBrief(userId: string, opts: { refresh?: boolean } = {}): Promise<Brief> {
  const hit = cache.get(userId);
  if (!opts.refresh && hit && Date.now() - hit.at < TTL_MS) return hit.brief;

  const { ctx, profile, granted } = await loadAgentContext(userId);
  const now = new Date();
  const firstName = ctx.userName.trim().split(/\s+/)[0] || "there";
  const tz = ctx.timezone;
  const connected = Boolean(await getGoogleAccount(userId));

  const empty: Brief = {
    greeting: timeOfDayGreeting(now, tz, firstName),
    summary: connected ? "Nothing urgent on your plate right now." : "Connect your Google account to see your day here.",
    connected,
    events: [], emails: [], tasks: [],
    generatedAt: now.toISOString(),
  };
  if (!connected) {
    cache.set(userId, { at: Date.now(), brief: empty });
    return empty;
  }

  const auth = await getGoogleAuth(userId).catch(() => null);
  if (!auth) return empty;
  const { end } = dayBounds(now, tz);

  const [events, emails, tasks] = await Promise.all([
    granted.includes("calendar")
      ? safe((async () => {
          const cal = google.calendar({ version: "v3", auth });
          const r = await cal.events.list({
            calendarId: "primary", timeMin: now.toISOString(), timeMax: end.toISOString(),
            singleEvents: true, orderBy: "startTime", maxResults: 15,
          });
          return (r.data.items ?? []).filter((e) => e.status !== "cancelled").map((e) => ({
            id: e.id ?? "",
            title: e.summary ?? "(no title)",
            start: e.start?.dateTime ?? e.start?.date ?? "",
            end: e.end?.dateTime ?? e.end?.date ?? "",
            meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? undefined,
            htmlLink: e.htmlLink ?? undefined,
          }));
        })(), [] as Brief["events"])
      : Promise.resolve([] as Brief["events"]),
    granted.includes("gmail")
      ? safe((async () => {
          const gm = google.gmail({ version: "v1", auth });
          const list = await gm.users.messages.list({
            userId: "me", q: "is:unread in:inbox newer_than:2d -category:promotions -category:social", maxResults: 8,
          });
          const out: Brief["emails"] = [];
          await Promise.all((list.data.messages ?? []).map(async (m) => {
            const r = await gm.users.messages.get({ userId: "me", id: m.id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] });
            const h = (n: string) => r.data.payload?.headers?.find((x) => x.name?.toLowerCase() === n)?.value ?? "";
            const when = Date.parse(h("date"));
            out.push({
              id: r.data.id ?? m.id!,
              threadId: r.data.threadId ?? "",
              from: h("from"),
              subject: h("subject") || "(no subject)",
              snippet: r.data.snippet ?? "",
              date: new Date(Number.isFinite(when) ? when : Number(r.data.internalDate ?? Date.now())).toISOString(),
              unread: (r.data.labelIds ?? []).includes("UNREAD"),
            });
          }));
          return out.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
        })(), [] as Brief["emails"])
      : Promise.resolve([] as Brief["emails"]),
    granted.includes("tasks")
      ? safe((async () => {
          const t = google.tasks({ version: "v1", auth });
          const lists = await t.tasklists.list({ maxResults: 5 });
          const out: Brief["tasks"] = [];
          for (const l of lists.data.items ?? []) {
            const r = await t.tasks.list({ tasklist: l.id!, showCompleted: false, dueMax: end.toISOString(), maxResults: 20 });
            for (const it of r.data.items ?? []) {
              if (it.status === "completed") continue;
              out.push({ id: it.id ?? "", title: it.title ?? "(untitled)", due: it.due ?? undefined });
            }
          }
          return out.slice(0, 15);
        })(), [] as Brief["tasks"])
      : Promise.resolve([] as Brief["tasks"]),
  ]);

  const brief: Brief = { ...empty, events, emails, tasks, generatedAt: new Date().toISOString() };

  if (events.length || emails.length || tasks.length) {
    try {
      const modelId = executorModelId(profile.model);
      const res = await generateText({
        model: executorModel(modelId),
        instructions: `You write the short dashboard greeting for ${firstName}'s personal assistant. Be warm, specific and calm; no emojis, no exclamation marks. Output "greeting" (a few words, e.g. "Good morning, ${firstName}.") and "summary" (exactly 2 sentences that mention concrete things: the next meeting and its time, who emailed, or what is due). Do not invent anything.`,
        prompt: `Now: ${formatLocalNow(now, tz)}\n\nRemaining events today:\n${events.map((e) => `- ${e.title} at ${e.start}`).join("\n") || "none"}\n\nUnread important emails:\n${emails.map((e) => `- ${e.from}: ${e.subject}`).join("\n") || "none"}\n\nTasks due or overdue:\n${tasks.map((t) => `- ${t.title}`).join("\n") || "none"}`,
        output: Output.object({ schema: z.object({ greeting: z.string(), summary: z.string() }) }),
        providerOptions: lowEffort,
        abortSignal: AbortSignal.timeout(20_000),
        maxRetries: 1,
      });
      brief.greeting = res.output.greeting.slice(0, 80);
      brief.summary = res.output.summary.slice(0, 400);
      await recordUsage(userId, modelId, { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 });
    } catch (e) {
      console.warn("[brief] summary generation failed:", e instanceof Error ? e.message : e);
      const parts: string[] = [];
      if (events[0]) parts.push(`Next up is ${events[0].title}.`);
      if (emails.length) parts.push(`${emails.length} unread email${emails.length === 1 ? "" : "s"} could use a look.`);
      if (tasks.length) parts.push(`${tasks.length} task${tasks.length === 1 ? " is" : "s are"} due.`);
      brief.summary = parts.join(" ") || empty.summary;
    }
  }

  cache.set(userId, { at: Date.now(), brief });
  return brief;
}
