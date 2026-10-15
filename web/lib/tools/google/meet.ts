import { z } from "zod";
import { defineTool, fail, type JarvisTool, type ToolResult } from "@/lib/tools/types";
import { guard, httpStatus, mapError, meetClient } from "./util";
import { createInstantMeetEvent } from "./calendar";

const meetCreateInstant = defineTool({
  name: "meet_create_instant",
  description: "Create an instant Google Meet room and return its link. Use when the user wants a meeting link right now ('start a call', 'give me a Meet link') without scheduling. For scheduled meetings with invites use calendar_create_event.",
  risk: "write",
  connector: "meet",
  inputSchema: z.object({ title: z.string().optional().describe("Optional label (only used if the fallback calendar-event route is needed).") }),
  title: () => "Creating a Google Meet room",
  execute: (input, ctx) =>
    guard("meet", async () => {
      let primaryErr: unknown;
      try {
        const meet = await meetClient(ctx);
        const created = await meet.spaces.create({ requestBody: {} });
        const name = created.data.name;
        const url = created.data.meetingUri;
        if (!name || !url) throw new Error("Meet API returned no space");
        const back = await meet.spaces.get({ name });
        const verified = back.data.meetingUri === url;
        return {
          ok: true,
          summary: `Meet room ready: ${url}`,
          data: { url, code: created.data.meetingCode, space: name },
          verified,
          evidence: verified ? `Meet space ${name} re-read: meetingUri matches` : `Meet space ${name} re-read returned a different uri`,
          card: { type: "meet", url, title: input.title },
        } satisfies ToolResult;
      } catch (err) {
        primaryErr = err;
        const st = httpStatus(err);
        if (st === 401 || (err as { code?: string })?.code === "google_not_connected") throw err;
      }
      // Fallback: a calendar event "now" with a Meet link
      try {
        const r = await createInstantMeetEvent(ctx, input.title || "Instant meeting");
        if (!r.meetLink) return fail("Meet link was not generated in time.", "upstream_error", "Try calendar_create_event with withMeet=true.");
        return {
          ok: true,
          summary: `Meet room ready (via calendar): ${r.meetLink}`,
          data: { url: r.meetLink, eventId: r.eventId, htmlLink: r.htmlLink, fallback: "calendar" },
          verified: true,
          evidence: `Calendar event ${r.eventId} re-read: hangoutLink present`,
          card: { type: "meet", url: r.meetLink, title: input.title },
        } satisfies ToolResult;
      } catch {
        return mapError(primaryErr, "meet");
      }
    }),
});

export const meetTools: JarvisTool[] = [meetCreateInstant];
