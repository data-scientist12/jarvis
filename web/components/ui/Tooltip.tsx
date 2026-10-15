import { cn } from "@/components/utils/cn";

/** CSS-only tooltip (hover or keyboard focus). */
export function Tooltip({
  content,
  children,
  className,
  side = "top",
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  side?: "top" | "bottom";
}) {
  if (!content) return <>{children}</>;
  return (
    <span className={cn("group/tt relative inline-flex", className)} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-lg bg-[#1d1d1f]/95 px-2.5 py-1.5 text-[12px] font-normal leading-4 text-white opacity-0 shadow-float transition-opacity duration-150 group-hover/tt:opacity-100 group-focus-visible/tt:opacity-100 dark:bg-[#3a3a3c]",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}
