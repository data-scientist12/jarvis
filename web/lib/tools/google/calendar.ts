import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { calendar_v3 } from "googleapis";
import { defineTool, fail, ok, type JarvisTool, type ToolContext, type ToolResult } from "@/lib/tools/types";
import {
  InputError,
  addDaysStr,
  atTime,
  calendarClient,
  cleanEmails,
  dayStart,
  formatHuman,
  googleTimeToLocal,
  guard,
  httpStatus,
  localDateStr,
  localParts,
  mapLimit,
  parseHM,
  parseWhen,
  short,
  sleep,
  toLocalISO,
  weekdayOf,
} from "./util";

type Cal = calendar_v3.Calendar;
type Ev = calendar_v3.Schema$Event;

const HOUR = 3_600_000;
const MIN = 60_000;

interface EventView {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  meetLink?: string;
  htmlLink?: string;
  attendees: { email: string; responseStatus: string }[];
  location?: string;
  organizer?: string;
  status?: string;
}

function meetLinkOf(ev: Ev): string | undefined {
  if (ev.hangoutLink) return ev.hangoutLink;
  return ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? undefined;
}

function view(ev: Ev, tz: string): EventView {
  return {
    id: ev.id ?? "",
    title: ev.summary || "(no title)",
    start: googleTimeToLocal(ev.start, tz),
    end: googleTimeToLocal(ev.end, tz),
    allDay: Boolean(ev.start?.date && !ev.start?.dateTime),
    meetLink: meetLinkOf(ev),
    htmlLink: ev.htmlLink ?? undefined,
    attendees: (ev.attendees ?? []).filter((a) => a.email && !a.resource).map((a) => ({ email: a.email as string, responseStatus: a.responseStatus ?? "needsAction" })),
    location: ev.location ?? undefined,
    organizer: ev.organizer?.email ?? undefined,
    status: ev.status ?? undefined,
  };
}

function evTimeMs(t: calendar_v3.Schema$EventDateTime | undefined, tz: string): number | undefined {
  if (!t) return undefined;
  if (t.dateTime) return new Date(t.dateTime).getTime();
  if (t.date) return dayStart(t.date, tz).getTime();
  return undefined;
}

/** For timeMax-style inputs: a bare date means "through the end of that day". */
function parseRangeEnd(input: string, tz: string): Date {
  const w = parseWhen(input, tz);
  return w.dateOnly ? dayStart(addDaysStr(localDateStr(w.date, tz), 1), tz) : w.date;
}

interface Interval {
  s: number;
  e: number;
}

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.s - b.s);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ ...i });
  }
  return out;
}

async function freeBusy(cal: Cal, calendars: string[], from: Date, to: Date, tz: string): Promise<{ busy: Interval[]; unavailable: string[] }> {
  const r = await cal.freebusy.query({
    requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), timeZone: tz, items: calendars.map((id) => ({ id })) },
  });
  const busy: Interval[] = [];
  const unavailable: string[] = [];
  for (const id of calendars) {
    const c = r.data.calendars?.[id];
    if (!c) continue;
    if (c.errors?.length) unavailable.push(id);
    for (const b of c.busy ?? []) if (b.start && b.end) busy.push({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() });
  }
  return { busy: mergeIntervals(busy), unavailable };
}

function localMinutes(d: Date, tz: string): number {
  const p = localParts(d, tz);
  return p.hour * 60 + p.minute + p.second / 60;
}

/* --------------------------------- list ------------------------------------ */

const calendarListEvents = defineTool({
  name: "calendar_list_events",
  description: "List calendar events in a time range (default: today). Use to answer 'what's on my calendar', check for conflicts, or find an event id before updating/deleting it.",
  risk: "read",
  connector: "calendar",
  inputSchema: z.object({
    timeMin: z.string().optional().describe("Range start, local ISO like 2026-10-16T09:00:00 or a date 2026-10-16. Default: today 00:00."),
    timeMax: z.string().optional().describe("Range end (a bare date means through the end of that day). Default: timeMin + 1 day."),
    query: z.string().optional().describe("Free-text filter on title/description/attendees."),
    max: z.number().int().min(1).max(100).default(25).describe("Max events."),
  }),
  title: (i) => (i.timeMin ? `Checking calendar from ${short(i.timeMin, 16)}` : "Checking today's calendar"),
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const tz = ctx.timezone;
      const from = input.timeMin ? parseWhen(input.timeMin, tz).date : dayStart(localDateStr(ctx.now, tz), tz);
      const to = input.timeMax ? parseRangeEnd(input.timeMax, tz) : dayStart(addDaysStr(localDateStr(from, tz), 1), tz);
      if (to <= from) throw new InputError("timeMax must be after timeMin.");
      const cal = await calendarClient(ctx);
      const r = await cal.events.list({
        calendarId: "primary",
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        q: input.query || undefined,
        singleEvents: true,
        orderBy: "startTime",
        maxResults: input.max,
        timeZone: tz,
      });
      const events = (r.data.items ?? []).filter((e) => e.status !== "cancelled").map((e) => view(e, tz));
      return ok(events.length ? `${events.length} event${events.length === 1 ? "" : "s"} between ${formatHuman(from, tz, { time: false })} and ${formatHuman(new Date(to.getTime() - 1), tz, { time: false })}` : "No events in that range", {
        data: { range: { from: toLocalISO(from, tz), to: toLocalISO(to, tz) }, count: events.length, events },
        card: { type: "event_list", events: events.map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end, meetLink: e.meetLink, htmlLink: e.htmlLink })) },
      });
    }),
});

/* ------------------------------- free slots -------------------------------- */

const calendarFindFreeSlots = defineTool({
  name: "calendar_find_free_slots",
  description:
    "Find free meeting slots (30-minute grid, working hours, weekdays only) across the user's calendar and optionally other people's calendars. Use before scheduling or when the user asks 'when am I free / when can we meet'. Resolve attendee names with contacts_search first.",
  risk: "read",
  connector: "calendar",
  inputSchema: z.object({
    durationMinutes: z.number().int().min(5).max(480).describe("Meeting length in minutes."),
    windowStart: z.string().describe("Search window start, local ISO or date, e.g. 2026-10-16 or 2026-10-16T09:00:00."),
    windowEnd: z.string().describe("Search window end (a bare date means through the end of that day)."),
    attendees: z.array(z.string()).max(20).optional().describe("Other people's email addresses whose availability must also be free."),
    workdayStart: z.string().default("09:00").describe("Earliest start of day, HH:MM local."),
    workdayEnd: z.string().default("18:00").describe("Latest end of day, HH:MM local."),
    maxSlots: z.number().int().min(1).max(20).default(5).describe("Max slots to return."),
  }),
  title: (i) => `Finding a free ${i.durationMinutes}-minute slot`,
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const tz = ctx.timezone;
      const attendees = cleanEmails(input.attendees, "attendees");
      const winStart = parseWhen(input.windowStart, tz).date;
      const winEnd = parseRangeEnd(input.windowEnd, tz);
      if (winEnd <= winStart) throw new InputError("windowEnd must be after windowStart.");
      if (winEnd.getTime() - winStart.getTime() > 62 * 24 * HOUR) throw new InputError("Search window is limited to 60 days.");
      const ws = parseHM(input.workdayStart);
      const we = parseHM(input.workdayEnd);
      if (we <= ws) throw new InputError("workdayEnd must be after workdayStart.");
      const dur = input.durationMinutes;
      const cal = await calendarClient(ctx);
      const { busy, unavailable } = await freeBusy(cal, ["primary", ...attendees], winStart, winEnd, tz);
      const earliest = Math.max(winStart.getTime(), ctx.now.getTime());

      const perDay = new Map<string, Interval[]>();
      const lastDay = localDateStr(new Date(winEnd.getTime() - 1), tz);
      for (let day = localDateStr(winStart, tz); day <= lastDay; day = addDaysStr(day, 1)) {
        const wd = weekdayOf(day);
        if (wd === 0 || wd === 6) continue;
        const list: Interval[] = [];
        for (let m = ws; m + dur <= we; m += 30) {
          const s = atTime(day, m, tz).getTime();
          const e = s + dur * MIN;
          if (s < earliest || e > winEnd.getTime()) continue;
          if (busy.some((b) => s < b.e && e > b.s)) continue;
          list.push({ s, e });
        }
        if (list.length) perDay.set(day, list);
      }
      // round-robin across days so options are spread out, avoiding overlapping picks on the same day
      const picks: Interval[] = [];
      let progress = true;
      while (picks.length < input.maxSlots && progress) {
        progress = false;
        for (const [, list] of perDay) {
          if (picks.length >= input.maxSlots) break;
          const idx = list.findIndex((c) => !picks.some((p) => c.s < p.e && c.e > p.s));
          if (idx >= 0) {
            picks.push(list[idx]);
            list.splice(idx, 1);
            progress = true;
          }
        }
      }
      picks.sort((a, b) => a.s - b.s);
      const slots = picks.map((p) => ({ start: toLocalISO(new Date(p.s), tz), end: toLocalISO(new Date(p.e), tz), label: `${formatHuman(new Date(p.s), tz)} – ${formatHuman(new Date(p.e), tz).split(", ").pop()}` }));
      const note = unavailable.length ? ` Could not read availability for ${unavailable.join(", ")} (treated as free).` : "";
      if (!slots.length) {
        return ok(`No free ${dur}-minute slots in that window.${note}`, {
          data: { slots: [], unavailable },
          suggestion: "Widen the window, shorten the meeting, or relax working hours.",
        });
      }
      return ok(`${slots.length} free ${dur}-minute slot${slots.length === 1 ? "" : "s"} found${attendees.length ? ` for you and ${attendees.length} other${attendees.length === 1 ? "" : "s"}` : ""}.${note}`, {
        data: { durationMinutes: dur, slots, unavailable },
        card: { type: "note", title: `Free ${dur}-minute slots`, text: slots.map((s) => `• ${s.label}`).join("\n") },
      });
    }),
});

/* --------------------------------- create ---------------------------------- */

async function eventConflicts(cal: Cal, start: Date, end: Date, tz: string): Promise<string[]> {
  try {
    const r = await cal.events.list({ calendarId: "primary", timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: true, maxResults: 10, timeZone: tz });
    return (r.data.items ?? [])
      .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent" && !(e.attendees ?? []).some((a) => a.self && a.responseStatus === "declined"))
      .map((e) => e.summary || "(no title)");
  } catch {
    return [];
  }
}

const calendarCreateEvent = defineTool({
  name: "calendar_create_event",
  description:
    "Create a Google Calendar event, optionally with a Google Meet link and invitations emailed to attendees. Use when the user asks to schedule, book or set up a meeting/event. Resolve names to emails with contacts_search first; check availability with calendar_find_free_slots when unsure.",
  risk: "high",
  connector: "calendar",
  inputSchema: z.object({
    title: z.string().min(1).describe("Event title."),
    start: z.string().describe("Start in the user's local time, e.g. 2026-10-16T16:00:00 (or a date for an all-day event)."),
    end: z.string().optional().describe("End in local time. Omit to use durationMinutes."),
    durationMinutes: z.number().int().min(5).max(1440).default(30).describe("Duration when end is not given."),
    attendees: z.array(z.string()).max(50).optional().describe("Attendee email addresses."),
    withMeet: z.boolean().default(true).describe("Add a Google Meet link."),
    description: z.string().optional().describe("Event description/agenda."),
    location: z.string().optional().describe("Physical location."),
    recurrence: z.array(z.string()).optional().describe("RRULE strings, e.g. ['RRULE:FREQ=WEEKLY;BYDAY=MO'] for recurring events."),
    sendInvites: z.boolean().default(true).describe("Email invitations to attendees."),
  }),
  title: (i) => `Scheduling “${short(i.title, 40)}”${i.attendees?.length ? ` with ${short(i.attendees.join(", "), 40)}` : ""}`,
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const tz = ctx.timezone;
      const attendees = cleanEmails(input.attendees, "attendees");
      const s = parseWhen(input.start, tz);
      const allDay = s.dateOnly;
      let start = s.date;
      let end: Date;
      if (input.end) end = allDay ? dayStart(addDaysStr(localDateStr(parseWhen(input.end, tz).date, tz), 0), tz) : parseWhen(input.end, tz).date;
      else end = allDay ? dayStart(addDaysStr(localDateStr(start, tz), 1), tz) : new Date(start.getTime() + input.durationMinutes * MIN);
      if (allDay && end <= start) end = dayStart(addDaysStr(localDateStr(start, tz), 1), tz);
      if (end <= start) throw new InputError("End must be after start.");
      if (!allDay && start.getTime() < ctx.now.getTime() - 5 * MIN) {
        throw new InputError(`Start time ${toLocalISO(start, tz)} is in the past.`, "Check the date/year; today is " + localDateStr(ctx.now, tz) + ".");
      }
      const cal = await calendarClient(ctx);
      const conflicts = allDay ? [] : await eventConflicts(cal, start, end, tz);
      const withMeet = input.withMeet && !allDay;
      const requestBody: Ev = {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: allDay ? { date: localDateStr(start, tz) } : { dateTime: toLocalISO(start, tz), timeZone: tz },
        end: allDay ? { date: localDateStr(end, tz) } : { dateTime: toLocalISO(end, tz), timeZone: tz },
        attendees: attendees.length ? attendees.map((email) => ({ email })) : undefined,
        recurrence: input.recurrence?.length ? input.recurrence : undefined,
        conferenceData: withMeet ? { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } : undefined,
      };
      const created = await cal.events.insert({
        calendarId: "primary",
        conferenceDataVersion: 1,
        sendUpdates: input.sendInvites && attendees.length ? "all" : "none",
        requestBody,
      });
      const id = created.data.id;
      if (!id) return fail("Google Calendar did not return an event id.", "upstream_error", "List events before retrying to avoid duplicates.");

      let got = (await cal.events.get({ calendarId: "primary", eventId: id })).data;
      const pending = (e: Ev) => e.conferenceData?.createRequest?.status?.statusCode === "pending" && !meetLinkOf(e);
      for (let i = 0; withMeet && pending(got) && i < 5; i++) {
        await sleep(1000);
        got = (await cal.events.get({ calendarId: "primary", eventId: id })).data;
      }
      const v = view(got, tz);
      const gotStart = evTimeMs(got.start ?? undefined, tz);
      const startOk = gotStart === start.getTime();
      const attOk = attendees.every((a) => v.attendees.some((x) => x.email.toLowerCase() === a));
      const meetOk = !withMeet || Boolean(v.meetLink);
      const exists = got.status !== "cancelled";
      const verified = exists && startOk && attOk && meetOk;
      const problems = [!exists && "event is cancelled", !startOk && "start time differs", !attOk && "attendees missing", !meetOk && "Meet link still pending"].filter(Boolean);
      start = new Date(gotStart ?? start.getTime());
      return {
        ok: exists && startOk,
        summary: `Event “${input.title}” created for ${allDay ? formatHuman(start, tz, { time: false }) : formatHuman(start, tz)}${attendees.length ? ` with ${attendees.length} attendee${attendees.length === 1 ? "" : "s"}` : ""}`,
        data: { id, title: input.title, start: v.start, end: v.end, meetLink: v.meetLink, htmlLink: v.htmlLink, attendees: attendees, invitesSent: input.sendInvites && attendees.length > 0, conflictsWith: conflicts },
        verified,
        evidence: verified
          ? `Re-read event ${id}: starts ${v.start}${v.meetLink ? `, Meet link ${v.meetLink}` : ""}${attendees.length ? `, ${attendees.length} attendees` : ""}`
          : `Re-read event ${id}: ${problems.join("; ")}`,
        suggestion: !meetOk ? "The Meet link is still being generated; call calendar_list_events shortly to get it." : conflicts.length ? `Note: overlaps with ${conflicts.join(", ")}.` : undefined,
        error: exists && startOk ? undefined : "upstream_error",
        card: { type: "event", title: input.title, start: v.start, end: v.end, meetLink: v.meetLink, htmlLink: v.htmlLink, attendees: v.attendees.map((a) => a.email), location: v.location },
      } satisfies ToolResult;
    }),
});

/* --------------------------------- update ---------------------------------- */

const calendarUpdateEvent = defineTool({
  name: "calendar_update_event",
  description: "Change an existing event: move/reschedule, rename, change duration, add attendees, edit description/location. Find the eventId with calendar_list_events first. If only start changes, the duration is kept. Attendees are emailed about changes.",
  risk: "write",
  connector: "calendar",
  inputSchema: z.object({
    eventId: z.string().describe("Event id from calendar_list_events."),
    title: z.string().optional().describe("New title."),
    start: z.string().optional().describe("New start in local time (e.g. 2026-10-17T10:00:00)."),
    end: z.string().optional().describe("New end in local time."),
    durationMinutes: z.number().int().min(5).max(1440).optional().describe("New duration in minutes."),
    addAttendees: z.array(z.string()).max(50).optional().describe("Emails to add as attendees."),
    description: z.string().optional().describe("New description."),
    location: z.string().optional().describe("New location."),
  }),
  title: (i) => (i.start ? "Rescheduling an event" : "Updating an event"),
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const tz = ctx.timezone;
      const cal = await calendarClient(ctx);
      const cur = (await cal.events.get({ calendarId: "primary", eventId: input.eventId })).data;
      const patch: Ev = {};
      const changes: string[] = [];
      if (input.title !== undefined) { patch.summary = input.title; changes.push("title"); }
      if (input.description !== undefined) { patch.description = input.description; changes.push("description"); }
      if (input.location !== undefined) { patch.location = input.location; changes.push("location"); }

      let newStartMs: number | undefined;
      if (input.start || input.end || input.durationMinutes) {
        const curAllDay = Boolean(cur.start?.date && !cur.start.dateTime);
        const curStart = evTimeMs(cur.start ?? undefined, tz);
        const curEnd = evTimeMs(cur.end ?? undefined, tz);
        if (curStart === undefined || curEnd === undefined) throw new InputError("The existing event has no readable start/end.");
        const ps = input.start ? parseWhen(input.start, tz) : undefined;
        const start = ps ? ps.date : new Date(curStart);
        let end: Date;
        if (input.end) end = parseRangeEndOrExact(input.end, tz);
        else if (input.durationMinutes) end = new Date(start.getTime() + input.durationMinutes * MIN);
        else end = ps ? new Date(start.getTime() + (curEnd - curStart)) : new Date(curEnd);
        if (end <= start) throw new InputError("End must be after start.");
        if (curAllDay && ps?.dateOnly) {
          patch.start = { date: localDateStr(start, tz) };
          patch.end = { date: localDateStr(end > start ? end : dayStart(addDaysStr(localDateStr(start, tz), 1), tz), tz) };
        } else {
          patch.start = { dateTime: toLocalISO(start, tz), timeZone: tz, ...(curAllDay ? { date: null } : {}) };
          patch.end = { dateTime: toLocalISO(end, tz), timeZone: tz, ...(curAllDay ? { date: null } : {}) };
        }
        newStartMs = start.getTime();
        changes.push("time");
      }

      let merged = cur.attendees ?? [];
      const add = cleanEmails(input.addAttendees, "addAttendees");
      if (add.length) {
        const have = new Set(merged.map((a) => a.email?.toLowerCase()));
        const fresh = add.filter((e) => !have.has(e));
        merged = [...merged, ...fresh.map((email) => ({ email }))];
        patch.attendees = merged;
        changes.push(`+${fresh.length} attendee${fresh.length === 1 ? "" : "s"}`);
      }
      if (!changes.length) throw new InputError("Nothing to change: provide at least one field to update.");

      await cal.events.patch({ calendarId: "primary", eventId: input.eventId, sendUpdates: merged.length ? "all" : "none", requestBody: patch });
      const got = (await cal.events.get({ calendarId: "primary", eventId: input.eventId })).data;
      const v = view(got, tz);
      const checks: string[] = [];
      if (input.title !== undefined && got.summary !== input.title) checks.push("title");
      if (input.description !== undefined && (got.description ?? "") !== input.description) checks.push("description");
      if (input.location !== undefined && (got.location ?? "") !== input.location) checks.push("location");
      if (newStartMs !== undefined && evTimeMs(got.start ?? undefined, tz) !== newStartMs) checks.push("start time");
      for (const a of add) if (!v.attendees.some((x) => x.email.toLowerCase() === a)) checks.push(`attendee ${a}`);
      const verified = checks.length === 0;
      return {
        ok: verified,
        summary: `Updated “${v.title}” (${changes.join(", ")})`,
        data: { id: input.eventId, title: v.title, start: v.start, end: v.end, meetLink: v.meetLink, htmlLink: v.htmlLink, attendees: v.attendees.map((a) => a.email) },
        verified,
        evidence: verified ? `Re-read event ${input.eventId}: now ${v.start} to ${v.end}, ${v.attendees.length} attendees` : `Re-read event ${input.eventId}: mismatch in ${checks.join(", ")}`,
        error: verified ? undefined : "upstream_error",
        card: { type: "event", title: v.title, start: v.start, end: v.end, meetLink: v.meetLink, htmlLink: v.htmlLink, attendees: v.attendees.map((a) => a.email), location: v.location },
      } satisfies ToolResult;
    }),
});

function parseRangeEndOrExact(input: string, tz: string): Date {
  return parseWhen(input, tz).date;
}

/* --------------------------------- delete ---------------------------------- */

const calendarDeleteEvent = defineTool({
  name: "calendar_delete_event",
  description: "Delete (cancel) a calendar event. Attendees are notified by default. Find the eventId with calendar_list_events first and confirm which event with the user if ambiguous.",
  risk: "high",
  connector: "calendar",
  inputSchema: z.object({
    eventId: z.string().describe("Event id from calendar_list_events."),
    notify: z.boolean().default(true).describe("Email cancellation notices to attendees."),
  }),
  title: () => "Cancelling a calendar event",
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const cal = await calendarClient(ctx);
      const cur = (await cal.events.get({ calendarId: "primary", eventId: input.eventId })).data;
      const name = cur.summary || "(no title)";
      if (cur.status === "cancelled") return ok(`“${name}” was already cancelled`, { verified: true, evidence: "Event status is cancelled" });
      await cal.events.delete({ calendarId: "primary", eventId: input.eventId, sendUpdates: input.notify ? "all" : "none" });
      let gone = false;
      let evidence = "";
      try {
        const after = (await cal.events.get({ calendarId: "primary", eventId: input.eventId })).data;
        gone = after.status === "cancelled";
        evidence = `Event ${input.eventId} status is now ${after.status}`;
      } catch (err) {
        const st = httpStatus(err);
        gone = st === 404 || st === 410;
        evidence = gone ? `Calendar returns HTTP ${st} for event ${input.eventId}` : `Re-read failed with ${String(err)}`;
      }
      return {
        ok: gone,
        summary: `Event “${name}” deleted${input.notify && cur.attendees?.length ? " and attendees notified" : ""}`,
        data: { id: input.eventId, title: name },
        verified: gone,
        evidence,
        error: gone ? undefined : "upstream_error",
        card: { type: "bulk", action: "event deleted", count: 1, items: [name] },
      } satisfies ToolResult;
    }),
});

/* --------------------------------- respond --------------------------------- */

const calendarRespond = defineTool({
  name: "calendar_respond",
  description: "Accept, decline or tentatively accept a calendar invitation the user received. Find the eventId with calendar_list_events first.",
  risk: "write",
  connector: "calendar",
  inputSchema: z.object({
    eventId: z.string().describe("Event id."),
    response: z.enum(["accepted", "declined", "tentative"]).describe("RSVP answer."),
  }),
  title: (i) => `Responding “${i.response}” to an invite`,
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const cal = await calendarClient(ctx);
      const cur = (await cal.events.get({ calendarId: "primary", eventId: input.eventId })).data;
      const atts = cur.attendees ?? [];
      if (!atts.some((a) => a.self)) {
        return fail(`You are not an invitee of “${cur.summary ?? "this event"}”, so there is nothing to RSVP to.`, "invalid_input", "Only events you were invited to can be accepted or declined.");
      }
      const next = atts.map((a) => (a.self ? { ...a, responseStatus: input.response } : a));
      await cal.events.patch({ calendarId: "primary", eventId: input.eventId, sendUpdates: "all", requestBody: { attendees: next } });
      const got = (await cal.events.get({ calendarId: "primary", eventId: input.eventId })).data;
      const mine = (got.attendees ?? []).find((a) => a.self);
      const verified = mine?.responseStatus === input.response;
      const v = view(got, ctx.timezone);
      return {
        ok: verified,
        summary: `${input.response === "accepted" ? "Accepted" : input.response === "declined" ? "Declined" : "Tentatively accepted"} “${v.title}”`,
        data: { id: input.eventId, title: v.title, responseStatus: mine?.responseStatus },
        verified,
        evidence: `Re-read event: your responseStatus is ${mine?.responseStatus ?? "unknown"}`,
        error: verified ? undefined : "upstream_error",
        card: { type: "event", title: v.title, start: v.start, end: v.end, meetLink: v.meetLink, htmlLink: v.htmlLink },
      } satisfies ToolResult;
    }),
});

/* ------------------------------- focus blocks ------------------------------ */

const FOCUS_COLOR = "9";

const calendarBlockFocusTime = defineTool({
  name: "calendar_block_focus_time",
  description:
    "Automatically carve focus-time blocks into the user's calendar: for each weekday in a date range, find free gaps inside working hours and book up to N hours. Use for 'protect my mornings', 'block 2 hours a day for deep work'. Skips days that already have focus blocks with the same title.",
  risk: "write",
  connector: "calendar",
  inputSchema: z.object({
    startDate: z.string().describe("First day, YYYY-MM-DD (local)."),
    endDate: z.string().describe("Last day inclusive, YYYY-MM-DD (max 31 days after startDate)."),
    hoursPerDay: z.number().min(0.5).max(8).default(2).describe("Focus hours to book per weekday."),
    title: z.string().default("Focus time").describe("Event title."),
    workdayStart: z.string().default("09:00").describe("Earliest HH:MM local."),
    workdayEnd: z.string().default("18:00").describe("Latest HH:MM local."),
  }),
  title: (i) => `Blocking ${i.hoursPerDay}h/day of focus time (${i.startDate} to ${i.endDate})`,
  execute: (input, ctx) =>
    guard("calendar", async () => {
      const tz = ctx.timezone;
      const first = localDateStr(parseWhen(input.startDate, tz).date, tz);
      const lastDay = localDateStr(parseWhen(input.endDate, tz).date, tz);
      if (lastDay < first) throw new InputError("endDate must not be before startDate.");
      if (addDaysStr(first, 31) < lastDay) throw new InputError("Range is limited to 31 days.");
      const ws = parseHM(input.workdayStart);
      const we = parseHM(input.workdayEnd);
      if (we <= ws) throw new InputError("workdayEnd must be after workdayStart.");
      const rangeStart = dayStart(first, tz);
      const rangeEnd = dayStart(addDaysStr(lastDay, 1), tz);
      const cal = await calendarClient(ctx);
      const { busy } = await freeBusy(cal, ["primary"], rangeStart, rangeEnd, tz);

      const existing = await cal.events.list({ calendarId: "primary", timeMin: rangeStart.toISOString(), timeMax: rangeEnd.toISOString(), q: input.title, singleEvents: true, maxResults: 250, timeZone: tz });
      const daysWithFocus = new Set<string>();
      for (const e of existing.data.items ?? []) {
        if (e.summary === input.title && e.status !== "cancelled") {
          const ms = evTimeMs(e.start ?? undefined, tz);
          if (ms !== undefined) daysWithFocus.add(localDateStr(new Date(ms), tz));
        }
      }

      const planned: { day: string; s: number; e: number }[] = [];
      let skippedDays = 0;
      let fullDays = 0;
      const needMin = Math.round(input.hoursPerDay * 60);
      for (let day = first; day <= lastDay; day = addDaysStr(day, 1)) {
        const wd = weekdayOf(day);
        if (wd === 0 || wd === 6) continue;
        if (daysWithFocus.has(day)) { skippedDays++; continue; }
        const dayBeg = atTime(day, ws, tz).getTime();
        const dayEnd = atTime(day, we, tz).getTime();
        let from = Math.max(dayBeg, ctx.now.getTime());
        // round `from` up to the next 30-minute boundary (local)
        const lm = localMinutes(new Date(from), tz);
        if (from > dayBeg) from = atTime(day, Math.ceil(lm / 30) * 30, tz).getTime();
        if (from >= dayEnd) continue;
        const gaps: Interval[] = [];
        let cursor = from;
        for (const b of busy) {
          if (b.e <= cursor) continue;
          if (b.s >= dayEnd) break;
          if (b.s > cursor) gaps.push({ s: cursor, e: Math.min(b.s, dayEnd) });
          cursor = Math.max(cursor, b.e);
        }
        if (cursor < dayEnd) gaps.push({ s: cursor, e: dayEnd });
        const aligned = gaps
          .map((g) => {
            const sMin = Math.ceil(localMinutes(new Date(g.s), tz) / 30) * 30;
            const eMin = Math.floor(localMinutes(new Date(g.e), tz) / 30) * 30;
            return { s: atTime(day, sMin, tz).getTime(), e: atTime(day, eMin, tz).getTime() };
          })
          .filter((g) => g.e - g.s >= 30 * MIN && g.s >= from);
        aligned.sort((a, b) => b.e - b.s - (a.e - a.s));
        let remaining = needMin;
        const chosen: Interval[] = [];
        for (const g of aligned) {
          if (remaining <= 0) break;
          const take = Math.min((g.e - g.s) / MIN, remaining);
          chosen.push({ s: g.s, e: g.s + take * MIN });
          remaining -= take;
        }
        if (!chosen.length) { fullDays++; continue; }
        for (const c of chosen.sort((a, b) => a.s - b.s)) planned.push({ day, s: c.s, e: c.e });
      }
      if (planned.length > 60) throw new InputError("That would create more than 60 blocks; shorten the date range.");
      if (!planned.length) {
        return ok(`No focus blocks created: ${skippedDays ? `${skippedDays} day(s) already have "${input.title}"` : "no free gaps found in working hours"}${fullDays ? `, ${fullDays} day(s) fully booked` : ""}`, {
          data: { created: 0, skippedDays, fullDays },
          verified: true,
          evidence: "Computed from freebusy; nothing to create",
        });
      }

      const results = await mapLimit(planned, 3, async (p) => {
        try {
          const r = await cal.events.insert({
            calendarId: "primary",
            sendUpdates: "none",
            requestBody: {
              summary: input.title,
              start: { dateTime: toLocalISO(new Date(p.s), tz), timeZone: tz },
              end: { dateTime: toLocalISO(new Date(p.e), tz), timeZone: tz },
              transparency: "opaque",
              colorId: FOCUS_COLOR,
              description: "Focus time blocked by Jarvis.",
            },
          });
          return r.data.id ?? null;
        } catch (err) {
          const st = httpStatus(err);
          if (st === 401 || st === 403) throw err;
          return null;
        }
      });
      const createdIds = results.filter((x): x is string => Boolean(x));
      const check = await cal.events.list({ calendarId: "primary", timeMin: rangeStart.toISOString(), timeMax: rangeEnd.toISOString(), q: input.title, singleEvents: true, maxResults: 250, timeZone: tz });
      const present = new Set((check.data.items ?? []).map((e) => e.id));
      const confirmed = createdIds.filter((id) => present.has(id)).length;
      const failed = planned.length - createdIds.length;
      const totalMin = planned.reduce((n, p) => n + (p.e - p.s) / MIN, 0);
      const verified = failed === 0 && confirmed === createdIds.length;
      const daysCovered = new Set(planned.map((p) => p.day)).size;
      return {
        ok: createdIds.length > 0 && failed === 0,
        summary: `Blocked ${createdIds.length} “${input.title}” slot${createdIds.length === 1 ? "" : "s"} (${(totalMin / 60).toFixed(1)}h) across ${daysCovered} day${daysCovered === 1 ? "" : "s"}${skippedDays ? `, ${skippedDays} day(s) already had one` : ""}${fullDays ? `, ${fullDays} day(s) too full` : ""}${failed ? `, ${failed} failed` : ""}`,
        data: { created: createdIds.length, failed, skippedDays, fullDays, blocks: planned.map((p) => ({ start: toLocalISO(new Date(p.s), tz), end: toLocalISO(new Date(p.e), tz) })) },
        verified,
        evidence: `Calendar lists ${confirmed}/${createdIds.length} of the new “${input.title}” events in the range`,
        error: failed ? "upstream_error" : undefined,
        suggestion: failed ? "Some blocks failed to create; run again to fill the missing ones (existing days are skipped)." : undefined,
        card: { type: "bulk", action: "focus blocks booked", count: createdIds.length, items: planned.slice(0, 12).map((p) => `${formatHuman(new Date(p.s), tz)} – ${formatHuman(new Date(p.e), tz).split(", ").pop()}`) },
      } satisfies ToolResult;
    }),
});

export const calendarTools: JarvisTool[] = [calendarListEvents, calendarFindFreeSlots, calendarCreateEvent, calendarUpdateEvent, calendarDeleteEvent, calendarRespond, calendarBlockFocusTime];

// kept for meet.ts fallback
export async function createInstantMeetEvent(ctx: ToolContext, title: string): Promise<{ eventId: string; meetLink?: string; htmlLink?: string }> {
  const cal = await calendarClient(ctx);
  const start = new Date(ctx.now.getTime() + MIN);
  const end = new Date(start.getTime() + 30 * MIN);
  const tz = ctx.timezone;
  const created = await cal.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    sendUpdates: "none",
    requestBody: {
      summary: title,
      start: { dateTime: toLocalISO(start, tz), timeZone: tz },
      end: { dateTime: toLocalISO(end, tz), timeZone: tz },
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
  });
  const id = created.data.id;
  if (!id) throw new Error("Calendar did not return an event id");
  let got = (await cal.events.get({ calendarId: "primary", eventId: id })).data;
  for (let i = 0; i < 5 && !meetLinkOf(got); i++) {
    await sleep(1000);
    got = (await cal.events.get({ calendarId: "primary", eventId: id })).data;
  }
  return { eventId: id, meetLink: meetLinkOf(got), htmlLink: got.htmlLink ?? undefined };
}
