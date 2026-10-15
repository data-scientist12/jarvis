"use client";

import { useState } from "react";
import { Archive, Check, Copy, StickyNote, Users, Video } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import type { Card } from "@/lib/tools/types";
import { CardLabel, CardShell, MoreRow } from "./CardShell";

type ContactData = Extract<Card, { type: "contact" }>;
type MeetData = Extract<Card, { type: "meet" }>;
type BulkData = Extract<Card, { type: "bulk" }>;
type NoteData = Extract<Card, { type: "note" }>;

export function ContactCard({ card }: { card: ContactData }) {
  return (
    <CardShell>
      <CardLabel icon={<Users />}>Contacts</CardLabel>
      <ul className="divide-y divide-hairline">
        {card.people.slice(0, 6).map((p, i) => (
          <li key={p.name + i} className="flex items-center gap-3.5 px-4 py-3">
            <Avatar name={p.name || p.emails[0]} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{p.name || p.emails[0]}</p>
              {p.emails.map((e) => (
                <a key={e} href={`mailto:${e}`} className="block truncate text-[13.5px] text-accent hover:underline">
                  {e}
                </a>
              ))}
              {p.phones.map((ph) => (
                <a key={ph} href={`tel:${ph}`} className="block truncate text-[13.5px] text-ink-2">
                  {ph}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <MoreRow count={card.people.length - 6} noun="more people" />
    </CardShell>
  );
}

export function MeetCard({ card }: { card: MeetData }) {
  const [copied, setCopied] = useState(false);
  return (
    <CardShell>
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-[#30b94d]/15 text-[#1f9a3a]">
            <Video className="size-6" strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <h4 className="truncate text-[16px] font-semibold">{card.title || "Google Meet"}</h4>
            <p className="truncate text-[13px] text-ink-3">{card.url.replace(/^https?:\/\//, "")}</p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="lg" className="flex-1" href={card.url} external icon={<Video className="size-5" strokeWidth={1.75} />}>
            Join
          </Button>
          <Button
            size="lg"
            variant="secondary"
            aria-label="Copy meeting link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(card.url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable */
              }
            }}
            icon={copied ? <Check className="size-4" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.75} />}
          >
            {copied ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </CardShell>
  );
}

export function BulkCard({ card }: { card: BulkData }) {
  const items = (card.items ?? []).slice(0, 6);
  return (
    <CardShell>
      <div className="flex items-center gap-4 px-5 py-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
          <Archive className="size-6" strokeWidth={1.5} />
        </span>
        <div className="min-w-0">
          <p className="text-[28px] font-semibold leading-none tracking-tight">{card.count}</p>
          <p className="mt-1 text-[14px] text-ink-2">{card.action}</p>
        </div>
      </div>
      {items.length > 0 && (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {items.map((it, i) => (
            <li key={it + i} className="truncate px-5 py-2 text-[13.5px] text-ink-2">
              {it}
            </li>
          ))}
        </ul>
      )}
      <MoreRow count={card.count - items.length > 0 && card.items ? card.count - items.length : 0} />
    </CardShell>
  );
}

export function NoteCard({ card }: { card: NoteData }) {
  return (
    <CardShell className="bg-[#fff9db] ring-[#f0e4a0] dark:bg-[#2b2814] dark:ring-[#4a4220]">
      <div className="p-4">
        <p className="flex items-center gap-2 text-[15px] font-semibold">
          <StickyNote className="size-4 text-warn" strokeWidth={1.75} /> {card.title}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{card.text}</p>
      </div>
    </CardShell>
  );
}
