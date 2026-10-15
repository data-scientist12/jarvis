/* eslint-disable @next/next/no-img-element */
import { cn } from "@/components/utils/cn";
import { hueFor, initials } from "@/components/utils/format";

export function Avatar({
  name,
  src,
  size = 32,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const label = name ?? "";
  const hue = hueFor(label || "jarvis");
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (src) {
    return <img src={src} alt={label} referrerPolicy="no-referrer" style={style} className={cn("shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span
      aria-hidden
      style={{ ...style, background: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 70% 50%))` }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
    >
      {initials(label)}
    </span>
  );
}

export function AvatarStack({ names, max = 4, size = 24 }: { names: string[]; max?: number; size?: number }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((n, i) => (
        <Avatar key={n + i} name={n} size={size} className={cn("ring-2 ring-surface", i > 0 && "-ml-1.5")} />
      ))}
      {extra > 0 && (
        <span
          style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
          className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-fill font-semibold text-ink-2 ring-2 ring-surface"
        >
          +{extra}
        </span>
      )}
    </div>
  );
}
