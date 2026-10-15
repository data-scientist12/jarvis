"use client";

import { Skeleton } from "@/components/ui/Skeleton";
import { CountUp } from "./CountUp";
import type { Stats } from "./types";

function Stat({ value, decimals, unit, label, color }: { value: number; decimals?: number; unit?: string; label: string; color: string }) {
  return (
    <div className="flex-1 px-5 py-5 sm:px-7">
      <p className="flex items-baseline gap-1 text-[40px] font-semibold leading-none tracking-[-0.03em] sm:text-[52px]" style={{ color }}>
        <CountUp value={value} decimals={decimals} />
        {unit && <span className="text-[18px] font-medium tracking-normal text-ink-2 sm:text-[22px]">{unit}</span>}
      </p>
      <p className="mt-2 text-[13px] text-ink-2 sm:text-[14px]">{label}</p>
    </div>
  );
}

export function StatsStrip({ stats }: { stats?: Stats }) {
  if (!stats) {
    return (
      <div className="flex divide-x divide-hairline rounded-3xl bg-surface shadow-card ring-1 ring-hairline">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex-1 px-5 py-5 sm:px-7">
            <Skeleton className="h-10 w-16" />
            <Skeleton className="mt-3 h-3 w-24" />
          </div>
        ))}
      </div>
    );
  }
  const hours = stats.minutesSavedWeek >= 120;
  return (
    <div className="flex divide-x divide-hairline overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-hairline">
      <Stat value={stats.actionsVerifiedWeek} label="Actions verified this week" color="var(--ok)" />
      <Stat
        value={hours ? stats.minutesSavedWeek / 60 : stats.minutesSavedWeek}
        decimals={hours ? 1 : 0}
        unit={hours ? "hr" : "min"}
        label="Time saved this week"
        color="var(--accent)"
      />
      <Stat value={stats.automationsActive} label="Automations active" color="#bf5af2" />
    </div>
  );
}
