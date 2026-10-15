"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}

export function JsonView({ label, value }: { label: string; value: unknown }) {
  const [copied, setCopied] = useState(false);
  if (value === undefined || value === null) return null;
  const text = safeStringify(value);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            } catch {
              /* clipboard unavailable */
            }
          }}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-fill hover:text-ink-2"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="thin-scroll max-h-56 overflow-auto rounded-lg bg-fill p-3 font-mono text-[12px] leading-[1.55] text-ink-2">{text}</pre>
    </div>
  );
}
