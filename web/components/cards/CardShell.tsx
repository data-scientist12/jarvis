"use client";

import { motion } from "motion/react";
import { cn } from "@/components/utils/cn";

/** Shared entrance + surface for result cards. */
export function CardShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className={cn("overflow-hidden rounded-2xl bg-surface shadow-card ring-1 ring-hairline", className)}
    >
      {children}
    </motion.div>
  );
}

export function CardLabel({ icon, children, right }: { icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
      <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-2 [&_svg]:size-3.5">
        {icon}
        {children}
      </span>
      {right}
    </div>
  );
}

export function MoreRow({ count, noun = "more" }: { count: number; noun?: string }) {
  if (count <= 0) return null;
  return <p className="px-4 py-2.5 text-[13px] text-ink-3">+{count} {noun}</p>;
}
