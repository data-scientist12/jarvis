import { MessageSquare, Sun, Zap } from "lucide-react";
import { cn } from "@/components/utils/cn";

const SRC = {
  chat: { icon: MessageSquare, color: "#0a84ff", label: "Chat" },
  automation: { icon: Zap, color: "#bf5af2", label: "Automation" },
  brief: { icon: Sun, color: "#ff9f0a", label: "Daily brief" },
} as const;

export function sourceLabel(source: string) {
  return (SRC as Record<string, { label: string }>)[source]?.label ?? "Run";
}

export function SourceIcon({ source, size = 40, className }: { source: string; size?: number; className?: string }) {
  const s = (SRC as Record<string, (typeof SRC)[keyof typeof SRC]>)[source] ?? SRC.chat;
  const Icon = s.icon;
  return (
    <span
      className={cn("flex shrink-0 items-center justify-center rounded-xl", className)}
      style={{ width: size, height: size, color: s.color, background: `color-mix(in srgb, ${s.color} 14%, transparent)` }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.5} />
    </span>
  );
}
