"use client";

import { CalendarDays, Inbox, ListTodo, Video } from "lucide-react";
import { TaskCircle } from "@/components/cards/TaskCards";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/components/utils/cn";
import { formatDay, formatRange, formatDue, relativeTime, senderName } from "@/components/utils/format";
import type { Brief } from "./types";

function WidgetSkeleton() {
  return (
    <div className="space-y-3 px-5 pb-5 pt-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function NotConnected() {
  return <EmptyState className="py-8" title="Google isn't connected" description="Connect Google to see this here." action={<Button size="sm" variant="secondary" href="/connectors">Open Connectors</Button>} />;
}

type Props = { brief?: Brief; loading: boolean; failed: boolean };

export function UpNextWidget({ brief, loading, failed }: Props) {
  const events = (brief?.events ?? []).slice(0, 4);
  return (
    <Card className="flex flex-col">
      <CardHeader icon={<CalendarDays className="size-4 text-[#ff3b30]" strokeWidth={1.75} />} title="Up next" />
      {loading ? (
        <WidgetSkeleton />
      ) : failed ? (
        <EmptyState className="py-8" title="Couldn't load your schedule" />
      ) : !brief?.connected ? (
        <NotConnected />
      ) : events.length === 0 ? (
        <EmptyState className="py-8" icon={<CalendarDays />} title="Nothing coming up" description="Your calendar is clear." />
      ) : (
        <ul className="px-2 pb-3">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14.5px] font-medium">{e.title}</p>
                <p className="text-[12.5px] text-ink-3">
                  {formatDay(e.start)} · {formatRange(e.start, e.end)}
                </p>
              </div>
              {e.meetLink && (
                <Button size="sm" href={e.meetLink} external icon={<Video className="size-3.5" strokeWidth={1.75} />}>
                  Join
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function InboxWidget({ brief, loading, failed }: Props) {
  const emails = (brief?.emails ?? []).slice(0, 4);
  return (
    <Card className="flex flex-col">
      <CardHeader icon={<Inbox className="size-4 text-accent" strokeWidth={1.75} />} title="Inbox" />
      {loading ? (
        <WidgetSkeleton />
      ) : failed ? (
        <EmptyState className="py-8" title="Couldn't load your inbox" />
      ) : !brief?.connected ? (
        <NotConnected />
      ) : emails.length === 0 ? (
        <EmptyState className="py-8" icon={<Inbox />} title="Inbox zero" description="Nothing important and unread." />
      ) : (
        <ul className="px-2 pb-3">
          {emails.map((m) => (
            <li key={m.id} className="relative rounded-xl py-2.5 pl-7 pr-3">
              <span className={cn("absolute left-3 top-[17px] size-2 rounded-full", m.unread ? "bg-accent" : "bg-transparent")} />
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[14px] font-semibold">{senderName(m.from)}</p>
                <span className="shrink-0 text-[12px] text-ink-3">{relativeTime(m.date)}</span>
              </div>
              <p className="truncate text-[13.5px] text-ink">{m.subject || "(no subject)"}</p>
              <p className="truncate text-[12.5px] text-ink-3">{m.snippet}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TasksWidget({ brief, loading, failed }: Props) {
  const tasks = (brief?.tasks ?? []).slice(0, 5);
  return (
    <Card className="flex flex-col">
      <CardHeader icon={<ListTodo className="size-4 text-warn" strokeWidth={1.75} />} title="Due today" />
      {loading ? (
        <WidgetSkeleton />
      ) : failed ? (
        <EmptyState className="py-8" title="Couldn't load your tasks" />
      ) : !brief?.connected ? (
        <NotConnected />
      ) : tasks.length === 0 ? (
        <EmptyState className="py-8" icon={<ListTodo />} title="All caught up" description="No tasks due today." />
      ) : (
        <ul className="px-2 pb-3">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5">
              <TaskCircle done={false} />
              <span className="min-w-0 flex-1 truncate text-[14.5px]">{t.title}</span>
              {t.due && <span className="shrink-0 text-[12.5px] text-ink-3">{formatDue(t.due)}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
