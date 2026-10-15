"use client";

import { useEffect, useState } from "react";
import type { OrbState } from "@/components/orb/Orb";

/**
 * Derives the orb state from chat activity. `flash` momentarily overrides
 * (success / error) for ~2.6s after a turn completes.
 */
export function useOrbState({
  busy,
  acting,
  flash,
}: {
  busy: boolean;
  /** true while a tool is actually running */
  acting: boolean;
  /** "success" | "error" | null; change the `key` to retrigger */
  flash: { kind: "success" | "error"; key: number } | null;
}): OrbState {
  const [shown, setShown] = useState<{ kind: "success" | "error"; key: number } | null>(null);
  const flashKind = flash?.kind;
  const flashKey = flash?.key;

  useEffect(() => {
    if (!flashKind || flashKey === undefined) return;
    const show = setTimeout(() => setShown({ kind: flashKind, key: flashKey }), 0);
    const hide = setTimeout(() => setShown(null), 2600);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [flashKind, flashKey]);

  if (shown && !busy) return shown.kind;
  if (acting) return "acting";
  if (busy) return "thinking";
  return "idle";
}
