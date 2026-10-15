"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/utils/cn";
import { Step } from "./Step";
import type { TimelineStep } from "./types";

function summarize(steps: TimelineStep[]) {
  const running = steps.filter((s) => s.status === "running").length;
  const waiting = steps.filter((s) => s.status === "approval").length;
  const failed = steps.filter((s) => s.status === "failed").length;
  const verified = steps.filter((s) => s.status === "verified").length;
  if (waiting) return "Waiting for your approval";
  if (running) return `Working · ${steps.length - running} of ${steps.length} steps done`;
  const parts = [`${steps.length} step${steps.length === 1 ? "" : "s"}`];
  if (verified) parts.push(`${verified} verified`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
}

/** Vertical list of agent steps. Collapses long, finished timelines behind a header. */
export function Timeline({
  steps,
  onApprove,
  onDeny,
  className,
  collapsible = true,
}: {
  steps: TimelineStep[];
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
  className?: string;
  collapsible?: boolean;
}) {
  const active = steps.some((s) => s.status === "running" || s.status === "approval");
  const [manual, setManual] = useState<boolean | null>(null);
  const defaultOpen = active || steps.length <= 3 || steps.some((s) => s.status === "failed");
  const open = !collapsible || (manual ?? defaultOpen);

  if (steps.length === 0) return null;
  return (
    <div className={cn("overflow-hidden rounded-2xl bg-surface ring-1 ring-hairline shadow-soft", className)}>
      {collapsible && (
        <button type="button" aria-expanded={open} onClick={() => setManual(!open)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left">
          <span className={cn("text-[13px] font-medium", active ? "text-ink" : "text-ink-2")}>{summarize(steps)}</span>
          <ChevronDown className={cn("size-4 text-ink-3 transition-transform", open && "rotate-180")} strokeWidth={1.75} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={collapsible ? { height: 0, opacity: 0 } : false}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 34 }}
            className="overflow-hidden"
          >
            <ol className={cn("px-4 pt-1", collapsible ? "border-t border-hairline pt-3" : "pt-4")}>
              {steps.map((s, i) => (
                <Step key={s.id} step={s} last={i === steps.length - 1} onApprove={onApprove} onDeny={onDeny} />
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
