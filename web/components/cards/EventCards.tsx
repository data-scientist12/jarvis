"use client";

import { CalendarDays, ExternalLink, MapPin, Video } from "lucide-react";
import { AvatarStack } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { formatDay, formatRange, toDate } from "@/components/utils/format";
import type { Card } from "@/lib/tools/types";
import { CardLabel, CardShell, MoreRow } from "./CardShell";

type EventCardData = Extract<Card, { type: "event" }>;
type EventListData = Extract<Card, { type: "event_list" }>;

/** Calendar.app-style date block. */
export function DateBlock({ start }: { start: string }) {
  const d = toDate(start);
  const month = d ? d.toLocaleDateString(undefined, { month: "short" }).toUpperCase() : "";
  const day = d ? d.getDate() : "";
  return (
    <div className="flex w-12 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-soft ring-1 ring-black/10 dark:bg-[#2c2c2e] dark:ring-white/10" aria-hidden>
      <span className="bg-[#ff3b30] py-[1px] text-[10px] font-bold leading-4 tracking-wide text-white">{month}</span>
      <span className="py-0.5 text-[22px] font-semibold leading-7 text-ink">{day}</span>
    </div>
  );
}

export function EventCard({ card }: { card: EventCardData }) {
  const attendees = card.attendees ?? [];
  return (
    <CardShell>
      <div className="flex gap-4 p-4">
        <DateBlock start={card.start} />
        <div className="min-w-0 flex-1">
          <h4 className="text-[16px] font-semibold leading-snug">{card.title}</h4>
          <p className="mt-0.5 text-[14px] text-ink-2">
            {formatDay(card.start)} · {formatRange(card.start, card.end)}
          </p>
          {card.location && (
            <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink-3">
              <MapPin className="size-3.5" strokeWidth={1.5} /> <span className="truncate">{card.location}</span>
            </p>
          )}
          {attendees.length > 0 && (
            <div className="mt-3 flex items-center gap-2">
              <AvatarStack names={attendees} />
              <span className="truncate text-[13px] text-ink-3">{attendees.length === 1 ? attendees[0] : `${attendees.length} attendees`}</span>
            </div>
          )}
          {(card.meetLink || card.htmlLink) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {card.meetLink && (
                <Button size="sm" href={card.meetLink} external icon={<Video className="size-4" strokeWidth={1.75} />}>
                  Join Meet
                </Button>
              )}
              {card.htmlLink && (
                <Button size="sm" variant="secondary" href={card.htmlLink} external icon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}>
                  Open in Calendar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </CardShell>
  );
}

export function EventListCard({ card }: { card: EventListData }) {
  const events = card.events.slice(0, 8);
  return (
    <CardShell>
      <CardLabel icon={<CalendarDays />} right={<span className="text-[12px] text-ink-3">{card.events.length} event{card.events.length === 1 ? "" : "s"}</span>}>
        Calendar
      </CardLabel>
      {events.length === 0 ? (
        <p className="px-4 py-5 text-[14px] text-ink-2">Nothing scheduled.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-[88px] shrink-0 text-[13px] leading-tight">
                <p className="font-medium text-accent">{formatDay(e.start)}</p>
                <p className="text-ink-3">{formatRange(e.start, e.end)}</p>
              </div>
              <p className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{e.title}</p>
              {e.meetLink && (
                <Button size="sm" variant="secondary" href={e.meetLink} external icon={<Video className="size-3.5" strokeWidth={1.75} />}>
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <MoreRow count={card.events.length - events.length} />
    </CardShell>
  );
}
