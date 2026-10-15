"use client";

import { useState } from "react";
import { ExternalLink, Inbox, Mail } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/utils/cn";
import { relativeTime, senderName } from "@/components/utils/format";
import type { Card } from "@/lib/tools/types";
import { CardLabel, CardShell, MoreRow } from "./CardShell";

type EmailData = Extract<Card, { type: "email" }>;
type EmailListData = Extract<Card, { type: "email_list" }>;

const STATUS: Record<EmailData["status"], { label: string; tone: Tone }> = {
  sent: { label: "Sent", tone: "ok" },
  draft: { label: "Draft", tone: "warn" },
  replied: { label: "Replied", tone: "accent" },
};

export function EmailCard({ card }: { card: EmailData }) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS[card.status];
  const long = card.body.length > 280 || card.body.split("\n").length > 5;
  return (
    <CardShell>
      <CardLabel icon={<Mail />} right={<Badge tone={s.tone}>{s.label}</Badge>}>
        Email
      </CardLabel>
      <div className="space-y-2 px-4 py-3.5">
        <div className="flex gap-3 text-[13.5px]">
          <span className="w-12 shrink-0 text-ink-3">To</span>
          <span className="min-w-0 flex-1 break-words">{card.to.join(", ") || "—"}</span>
        </div>
        <div className="flex gap-3 text-[13.5px]">
          <span className="w-12 shrink-0 text-ink-3">Subject</span>
          <span className="min-w-0 flex-1 font-semibold">{card.subject}</span>
        </div>
        <div className="h-px bg-hairline" />
        <p className={cn("whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink-2", !expanded && "line-clamp-5")}>{card.body}</p>
        <div className="flex items-center gap-3 pt-1">
          {long && (
            <button onClick={() => setExpanded((e) => !e)} className="text-[13px] font-medium text-accent">
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
          {card.link && (
            <Button size="sm" variant="secondary" href={card.link} external icon={<ExternalLink className="size-3.5" strokeWidth={1.75} />}>
              Open in Gmail
            </Button>
          )}
        </div>
      </div>
    </CardShell>
  );
}

export function EmailListCard({ card }: { card: EmailListData }) {
  const emails = card.emails.slice(0, 8);
  return (
    <CardShell>
      <CardLabel icon={<Inbox />} right={<span className="text-[12px] text-ink-3">{card.emails.length} message{card.emails.length === 1 ? "" : "s"}</span>}>
        {card.query ? <span className="normal-case tracking-normal">Inbox · {card.query}</span> : "Inbox"}
      </CardLabel>
      {emails.length === 0 ? (
        <p className="px-4 py-5 text-[14px] text-ink-2">No messages found.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {emails.map((m) => (
            <li key={m.id} className="relative flex gap-3 py-3 pl-8 pr-4">
              {m.unread && <span className="absolute left-3.5 top-[19px] size-2 rounded-full bg-accent" aria-label="Unread" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className={cn("truncate text-[14px]", m.unread ? "font-semibold" : "font-medium")}>{senderName(m.from)}</p>
                  <span className="shrink-0 text-[12px] text-ink-3">{relativeTime(m.date)}</span>
                </div>
                <p className={cn("truncate text-[13.5px]", m.unread ? "text-ink" : "text-ink-2")}>{m.subject || "(no subject)"}</p>
                <p className="truncate text-[13px] text-ink-3">{m.snippet}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <MoreRow count={card.emails.length - emails.length} noun="more messages" />
    </CardShell>
  );
}
