import type { HTMLAttributes } from "react";
import { cn } from "@/components/utils/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl bg-surface shadow-card ring-1 ring-hairline", className)} {...rest} />;
}

export function CardHeader({ title, action, icon, className }: { title: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 pt-4 pb-2", className)}>
      <div className="flex min-w-0 items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-ink-2">
        {icon}
        <span className="truncate">{title}</span>
      </div>
      {action}
    </div>
  );
}
