"use client";

import { motion } from "motion/react";
import { BellRing, CalendarClock, FilePlus, ListTodo, Newspaper, Timer, type LucideIcon } from "lucide-react";

export type Suggestion = { label: string; prompt: string; icon: LucideIcon; /** needs the user to finish the sentence */ fill?: boolean };

export const SUGGESTIONS: Suggestion[] = [
  { label: "Clear newsletters from my inbox", prompt: "Clear newsletters from my inbox", icon: Newspaper },
  { label: "Schedule a 30-min Meet with …", prompt: "Schedule a 30-min Meet with ", icon: CalendarClock, fill: true },
  { label: "Follow up on unanswered emails", prompt: "Find emails I haven't gotten replies to and draft follow-ups", icon: BellRing },
  { label: "Turn unread emails into tasks", prompt: "Turn my unread emails into tasks", icon: ListTodo },
  { label: "Block focus time this week", prompt: "Block focus time this week", icon: Timer },
  { label: "Summarize today's meetings into a doc", prompt: "Summarize today's meetings into a doc", icon: FilePlus },
];

export function SuggestionChips({ onPick, className }: { onPick: (s: Suggestion) => void; className?: string }) {
  return (
    <div className={className}>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.button
              key={s.label}
              type="button"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30, delay: 0.04 * i }}
              onClick={() => onPick(s)}
              className="inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-[14px] text-ink shadow-soft ring-1 ring-hairline transition-[background-color,transform] hover:bg-fill active:scale-[0.97]"
            >
              <Icon className="size-4 text-accent" strokeWidth={1.5} />
              {s.label}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
