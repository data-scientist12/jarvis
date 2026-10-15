import { cn } from "@/components/utils/cn";

export type Tone = "neutral" | "ok" | "warn" | "bad" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-fill text-ink-2",
  ok: "bg-ok/15 text-[#1f8a3b] dark:text-ok",
  warn: "bg-warn/15 text-[#b36b00] dark:text-warn",
  bad: "bg-bad/12 text-bad",
  accent: "bg-accent/12 text-accent",
};

export function Badge({ tone = "neutral", className, children, icon }: { tone?: Tone; className?: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-[2px] text-[12px] font-medium leading-5", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
