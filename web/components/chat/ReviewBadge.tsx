"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import { cn } from "@/components/utils/cn";
import type { ReviewData } from "./types";

const STYLE = {
  succeeded: { icon: CircleCheck, text: "text-[#1f8a3b] dark:text-ok", bg: "bg-ok/12", ring: "ring-ok/25" },
  partial: { icon: TriangleAlert, text: "text-[#b36b00] dark:text-warn", bg: "bg-warn/12", ring: "ring-warn/30" },
  failed: { icon: CircleAlert, text: "text-bad", bg: "bg-bad/10", ring: "ring-bad/25" },
  needs_input: { icon: CircleHelp, text: "text-accent", bg: "bg-accent/10", ring: "ring-accent/25" },
} as const;

export function reviewLabel(review: ReviewData, verified: number, total: number) {
  switch (review.status) {
    case "succeeded":
      return total > 0 ? `Done · ${verified} of ${total} verified` : "Done";
    case "partial":
      return "Partially done";
    case "failed":
      return "Failed";
    case "needs_input":
      return "Needs your input";
  }
}

/** The reviewer's verdict at the end of an assistant turn (`data-review`). */
export function ReviewBadge({ review, verified, total, runId }: { review: ReviewData; verified: number; total: number; runId?: string }) {
  const s = STYLE[review.status];
  const Icon = s.icon;
  const missing = review.missing ?? [];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn("rounded-2xl px-4 py-3 ring-1", s.bg, s.ring)}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("size-[18px] shrink-0", s.text)} strokeWidth={1.75} />
        <p className={cn("text-[14px] font-semibold", s.text)}>{reviewLabel(review, verified, total)}</p>
        {runId && (
          <Link href={`/activity/${runId}`} className="ml-auto shrink-0 text-[12.5px] text-ink-2 hover:text-ink">
            Details
          </Link>
        )}
      </div>
      {review.summary && review.status !== "succeeded" && <p className="mt-1 text-[13.5px] text-ink-2">{review.summary}</p>}
      {review.status === "succeeded" && review.summary && <p className="mt-1 text-[13.5px] text-ink-2">{review.summary}</p>}
      {missing.length > 0 && (
        <ul className="mt-2 space-y-1">
          {missing.map((m, i) => (
            <li key={i} className="flex gap-2 text-[13.5px] text-ink-2">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-current opacity-60" />
              {m}
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
