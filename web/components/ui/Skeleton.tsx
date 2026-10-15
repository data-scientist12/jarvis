import { cn } from "@/components/utils/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-skeleton rounded-lg bg-fill", className)} />;
}
