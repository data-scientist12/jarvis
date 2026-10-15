"use client";

import { Check, ListTodo } from "lucide-react";
import { cn } from "@/components/utils/cn";
import { formatDue } from "@/components/utils/format";
import type { Card } from "@/lib/tools/types";
import { CardLabel, CardShell, MoreRow } from "./CardShell";

type TaskData = Extract<Card, { type: "task" }>;
type TaskListData = Extract<Card, { type: "task_list" }>;

/** iOS Reminders-style circle. */
export function TaskCircle({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors",
        done ? "border-accent bg-accent text-white" : "border-ink-3",
      )}
    >
      {done && <Check className="size-3.5" strokeWidth={3} />}
    </span>
  );
}

export function TaskCard({ card }: { card: TaskData }) {
  const done = card.status === "completed";
  return (
    <CardShell>
      <div className="flex items-center gap-3.5 px-4 py-3.5">
        <TaskCircle done={done} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-[15px] font-medium", done && "text-ink-3 line-through")}>{card.title}</p>
          <p className="text-[13px] text-ink-3">
            {done ? "Completed" : "Added"}
            {card.due ? ` · Due ${formatDue(card.due)}` : ""}
            {card.list ? ` · ${card.list}` : ""}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

export function TaskListCard({ card }: { card: TaskListData }) {
  const tasks = card.tasks.slice(0, 10);
  return (
    <CardShell>
      <CardLabel icon={<ListTodo />} right={<span className="text-[12px] text-ink-3">{card.tasks.length} task{card.tasks.length === 1 ? "" : "s"}</span>}>
        Tasks
      </CardLabel>
      {tasks.length === 0 ? (
        <p className="px-4 py-5 text-[14px] text-ink-2">All clear.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {tasks.map((t) => {
            const done = t.status === "completed";
            return (
              <li key={t.id} className="flex items-center gap-3.5 px-4 py-3">
                <TaskCircle done={done} />
                <span className={cn("min-w-0 flex-1 truncate text-[14.5px]", done && "text-ink-3 line-through")}>{t.title}</span>
                {t.due && <span className="shrink-0 text-[12.5px] text-ink-3">{formatDue(t.due)}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <MoreRow count={card.tasks.length - tasks.length} noun="more tasks" />
    </CardShell>
  );
}
