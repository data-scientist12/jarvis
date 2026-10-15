import { cn } from "@/components/utils/cn";

export type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover shadow-soft",
  secondary: "bg-fill text-ink hover:bg-fill-strong",
  ghost: "text-accent hover:bg-fill",
  outline: "bg-surface text-ink ring-1 ring-hairline-strong hover:bg-fill",
  danger: "bg-bad/10 text-bad hover:bg-bad/15",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-full",
  md: "h-10 px-4 text-[14px] gap-2 rounded-full",
  lg: "h-12 px-6 text-[16px] gap-2 rounded-full",
};

export const buttonClass = (variant: Variant = "primary", size: Size = "md", extra?: string) =>
  cn(
    "inline-flex shrink-0 select-none items-center justify-center font-medium transition-[background-color,transform,opacity] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
    variants[variant],
    sizes[size],
    extra,
  );

