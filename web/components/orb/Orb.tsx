import type { CSSProperties } from "react";
import { cn } from "@/components/utils/cn";

export type OrbState = "idle" | "thinking" | "acting" | "success" | "error" | "listening";

/**
 * Jarvis Orb: a soft, Siri-like fluid gradient sphere. Pure CSS (see globals.css, ".orb").
 *  - idle: slow breathing
 *  - thinking: faster swirl
 *  - acting: pulse ring per `pulseKey` change
 *  - success / error: brief green / red tint
 *  - listening: scales with `level` (0..1)
 */
export function Orb({
  size = 88,
  state = "idle",
  level = 0,
  pulseKey = 0,
  className,
}: {
  size?: number;
  state?: OrbState;
  level?: number;
  pulseKey?: number;
  className?: string;
}) {
  const style = {
    "--orb-size": `${size}px`,
    "--orb-level": state === "listening" ? Math.min(1, Math.max(0, level)).toFixed(3) : 0,
  } as CSSProperties;
  return (
    <div className={cn("orb", className)} data-state={state} style={style} aria-hidden>
      <span className="orb-glow" />
      <span className="orb-sphere">
        <span className="orb-blob b1" />
        <span className="orb-blob b2" />
        <span className="orb-blob b3" />
        <span className="orb-blob b4" />
        <span className="orb-conic" />
        <span className="orb-tint" />
        <span className="orb-shine" />
      </span>
      {pulseKey > 0 && <span key={pulseKey} className="orb-pulse" />}
    </div>
  );
}
