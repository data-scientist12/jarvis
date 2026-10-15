"use client";

import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { Orb, type OrbState } from "@/components/orb/Orb";
import { Spinner } from "@/components/ui/Spinner";
import { toast } from "@/components/ui/Toaster";
import { cn } from "@/components/utils/cn";
import { useRecorder } from "@/hooks/useRecorder";

/**
 * Large rounded composer. Enter sends, Shift+Enter inserts a newline.
 * Mic: press and hold to talk (release sends to /api/transcribe) or click to start/stop.
 * `variant="hero"` shows the big orb above the field (dashboard); `dock` shows a small orb at the left.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  onStop,
  orbState = "idle",
  orbPulseKey = 0,
  placeholder = "Ask Jarvis to do something…",
  variant = "dock",
  autoFocus,
  textareaRef,
  disabled,
  heroTitle,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (text: string) => void;
  busy?: boolean;
  onStop?: () => void;
  orbState?: OrbState;
  orbPulseKey?: number;
  placeholder?: string;
  variant?: "hero" | "dock";
  autoFocus?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  /** hero only: rendered between the orb and the field (greeting, summary) */
  heroTitle?: React.ReactNode;
}) {
  const ownRef = useRef<HTMLTextAreaElement | null>(null);
  const innerRef = textareaRef ?? ownRef;
  const downAt = useRef(0);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value, innerRef]);

  const recorder = useRecorder({
    onText: (t) => {
      const cur = valueRef.current;
      onChange(cur ? `${cur.replace(/\s+$/, "")} ${t}` : t);
      innerRef.current?.focus();
    },
    onError: (m) => toast.error(m),
  });

  // Auto-grow up to ~8 lines.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value, innerRef]);

  useEffect(() => {
    if (autoFocus) innerRef.current?.focus();
  }, [autoFocus, innerRef]);

  const send = () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    onSubmit(text);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const recording = recorder.state === "recording";
  const transcribing = recorder.state === "transcribing";
  const shownOrb: OrbState = recording ? "listening" : transcribing ? "thinking" : orbState;
  const hasText = value.trim().length > 0;
  const hero = variant === "hero";

  return (
    <div className={cn("w-full", hero && "flex flex-col items-center")}>
      {hero && (
        <>
          <div className="mb-6 md:hidden">
            <Orb size={112} state={shownOrb} level={recorder.level} pulseKey={orbPulseKey} />
          </div>
          <div className="mb-8 hidden md:block">
            <Orb size={160} state={shownOrb} level={recorder.level} pulseKey={orbPulseKey} />
          </div>
          {heroTitle}
        </>
      )}
      <div
        className={cn(
          "flex w-full items-end gap-2 bg-surface shadow-card ring-1 ring-hairline transition-shadow focus-within:ring-2 focus-within:ring-accent/60",
          hero ? "rounded-[28px] p-3 pl-5" : "rounded-[26px] p-2 pl-3",
        )}
      >
        {!hero && (
          <div className="flex size-11 shrink-0 items-center justify-center self-end">
            <Orb size={34} state={shownOrb} level={recorder.level} pulseKey={orbPulseKey} />
          </div>
        )}
        <textarea
          ref={innerRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={recording ? "Listening…" : transcribing ? "Transcribing…" : placeholder}
          aria-label="Message Jarvis"
          className={cn(
            "thin-scroll max-h-[200px] min-h-11 flex-1 resize-none bg-transparent py-[11px] text-[16px] leading-[22px] text-ink outline-none placeholder:text-ink-3",
            hero && "text-[17px]",
          )}
        />
        <div className="flex shrink-0 items-center gap-1.5 self-end pb-[2px]">
          {recorder.supported && (
            <button
              type="button"
              aria-label={recording ? "Stop recording" : "Record voice message"}
              aria-pressed={recording}
              disabled={transcribing || disabled}
              onPointerDown={(e) => {
                e.preventDefault();
                if (recorder.state === "recording") {
                  recorder.stop();
                  return;
                }
                downAt.current = Date.now();
                void recorder.start();
              }}
              onPointerUp={() => {
                // Held for a while = push-to-talk (release stops). A quick tap keeps recording until the next tap.
                if (recorder.state === "recording" && Date.now() - downAt.current > 500) recorder.stop();
              }}
              onClick={(e) => {
                // Keyboard activation (Enter/Space) has detail === 0: toggle.
                if (e.detail !== 0) return;
                if (recorder.state === "recording") recorder.stop();
                else if (recorder.state === "idle") void recorder.start();
              }}
              className={cn(
                "flex size-10 items-center justify-center rounded-full transition-colors disabled:opacity-40",
                recording ? "bg-bad text-white" : "text-ink-2 hover:bg-fill",
              )}
            >
              {transcribing ? <Spinner size={16} /> : <Mic className="size-[19px]" strokeWidth={1.6} />}
            </button>
          )}
          {busy ? (
            <button type="button" aria-label="Stop generating" onClick={onStop} className="flex size-10 items-center justify-center rounded-full bg-ink text-canvas transition-transform active:scale-95">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              onClick={send}
              disabled={!hasText || disabled}
              className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-ink transition-[opacity,transform] hover:bg-accent-hover active:scale-95 disabled:bg-fill-strong disabled:text-ink-3"
            >
              <ArrowUp className="size-5" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
