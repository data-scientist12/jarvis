"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { cn } from "@/components/utils/cn";

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; hint?: string };

/** iOS segmented control with a sliding thumb. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  size?: "sm" | "md";
}) {
  const id = useId();
  return (
    <div role="tablist" className={cn("inline-flex rounded-[10px] bg-fill p-[2px]", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-0 rounded-[8px] px-3.5 font-medium transition-colors",
              size === "sm" ? "h-7 text-[13px]" : "h-8 text-[14px]",
              active ? "text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-[8px] bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.14)]"
                transition={{ type: "spring", stiffness: 400, damping: 34 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
