"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Ban, Check, ChevronRight, ShieldAlert, X } from "lucide-react";
import { cn } from "@/components/utils/cn";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { Tooltip } from "@/components/ui/Tooltip";
import { JsonView } from "./JsonView";
import { toolMeta } from "./toolMeta";
import type { StepStatus, TimelineStep } from "./types";

const MARKER: Record<StepStatus, { bg: string; node: React.ReactNode }> = {
  running: { bg: "bg-accent", node: <Spinner size={9} className="text-white" /> },
  verified: { bg: "bg-ok", node: <Check className="size-2.5 text-white" strokeWidth={3.5} /> },
  done: { bg: "bg-accent", node: <Check className="size-2.5 text-white" strokeWidth={3.5} /> },
  unverified: { bg: "bg-ink-3", node: <Check className="size-2.5 text-white" strokeWidth={3.5} /> },
  failed: { bg: "bg-bad", node: <X className="size-2.5 text-white" strokeWidth={3.5} /> },
  approval: { bg: "bg-warn", node: <ShieldAlert className="size-2.5 text-white" strokeWidth={3} /> },
  denied: { bg: "bg-ink-3", node: <Ban className="size-2.5 text-white" strokeWidth={3} /> },
};

function StatusChip({ step }: { step: TimelineStep }) {
  switch (step.status) {
    case "running":
      return <Badge tone="accent">Running</Badge>;
    case "verified":
      return (
        <Tooltip content={step.evidence ? `Evidence: ${step.evidence}` : "Confirmed by re-reading from the source"} side="bottom">
          <Badge tone="ok" icon={<Check className="size-3" strokeWidth={3} />}>
            Verified
          </Badge>
        </Tooltip>
      );
    case "done":
      return null;
    case "unverified":
      return <Badge tone="warn">Unverified</Badge>;
    case "failed":
      return <Badge tone="bad">Failed</Badge>;
    case "approval":
      return <Badge tone="warn">Needs approval</Badge>;
    case "denied":
      return <Badge tone="neutral">Denied</Badge>;
  }
}

/** Compact "to: x · subject: y" preview of what is about to happen, for approvals. */
function InputPreview({ input }: { input: unknown }) {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .slice(0, 6);
  if (!entries.length) return null;
  return (
    <dl className="mt-2 space-y-1 rounded-xl bg-fill p-3 text-[13px]">
      {entries.map(([k, v]) => {
        const text = typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(", ") : JSON.stringify(v);
        return (
          <div key={k} className="flex gap-3">
            <dt className="w-20 shrink-0 text-ink-3">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</dt>
            <dd className="min-w-0 flex-1 whitespace-pre-wrap break-words text-ink">{text.length > 280 ? `${text.slice(0, 280)}…` : text}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function Step({
  step,
  last,
  onApprove,
  onDeny,
}: {
  step: TimelineStep;
  last?: boolean;
  onApprove?: (approvalId: string) => void;
  onDeny?: (approvalId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = toolMeta(step.tool);
  const Icon = meta.icon;
  const marker = MARKER[step.status];
  const hasDetail = step.input !== undefined || step.output !== undefined;
  const headline = step.status === "running" || step.status === "approval" ? step.title : step.summary || step.title;
  const sub = step.status === "running" || step.status === "approval" ? meta.label : `${meta.label} · ${step.title}${step.durationMs ? ` · ${(step.durationMs / 1000).toFixed(1)}s` : ""}`;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="relative flex gap-3"
    >
      {/* rail */}
      {!last && <span aria-hidden className="absolute left-[17px] top-[40px] bottom-[-8px] w-px bg-hairline" />}

      <div className="relative z-10 mt-1 shrink-0">
        <span
          className="flex size-[34px] items-center justify-center rounded-[11px]"
          style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 14%, transparent)` }}
        >
          <Icon className="size-[18px]" strokeWidth={1.6} />
        </span>
        <span className={cn("absolute -bottom-1 -right-1 flex size-[15px] items-center justify-center rounded-full ring-2 ring-surface", marker.bg)}>{marker.node}</span>
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <button
          type="button"
          disabled={!hasDetail}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className={cn("group flex w-full items-start gap-2 rounded-lg text-left", hasDetail && "cursor-pointer")}
        >
          <span className="min-w-0 flex-1">
            <span className={cn("block text-[14.5px] font-medium leading-snug", step.status === "running" ? "text-shimmer" : "text-ink", step.status === "denied" && "text-ink-2 line-through decoration-ink-3")}>
              {headline}
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{sub}</span>
          </span>
          <span className="mt-0.5 flex shrink-0 items-center gap-1.5">
            <StatusChip step={step} />
            {hasDetail && <ChevronRight className={cn("size-4 text-ink-3 transition-transform", open && "rotate-90")} strokeWidth={1.75} />}
          </span>
        </button>

        {step.status === "failed" && (step.error || step.suggestion) && (
          <div className="mt-1.5 rounded-xl bg-bad/8 px-3 py-2 text-[13px]">
            {step.error && <p className="text-bad">{step.error.replace(/_/g, " ")}</p>}
            {step.suggestion && <p className="mt-0.5 text-ink-2">{step.suggestion}</p>}
          </div>
        )}

        {step.status === "approval" && step.approvalId && (
          <div className="mt-2">
            <p className="text-[13px] text-ink-2">{step.approvalReason || "Jarvis wants to do this and is waiting for your OK."}</p>
            <InputPreview input={step.input} />
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={() => onApprove?.(step.approvalId!)}>
                Approve
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onDeny?.(step.approvalId!)}>
                Deny
              </Button>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {open && hasDetail && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 34 }}
              className="overflow-hidden"
            >
              <div className="mt-2 space-y-3">
                <JsonView label="Input" value={step.input} />
                <JsonView label="Output" value={step.output} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.li>
  );
}
