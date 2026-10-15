"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { Clock, Play, Trash } from "lucide-react";
import { RunStatusBadge } from "@/components/activity/RunStatusBadge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui/Switch";
import { cn } from "@/components/utils/cn";
import { describeTrigger, formatDateTime, relativeTime } from "@/components/utils/format";
import type { Automation } from "./types";

export function AutomationCard({
  automation: a,
  onToggle,
  onRun,
  onDelete,
}: {
  automation: Automation;
  onToggle: (next: boolean) => void;
  onRun: () => Promise<void>;
  onDelete: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isManual = !a.trigger || (typeof a.trigger === "object" && (a.trigger as { type?: string }).type === "manual");

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <Card className={cn("p-5 transition-opacity", !a.enabled && "opacity-70")}>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-semibold leading-snug tracking-tight">{a.name}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-[13.5px] text-accent">
              <Clock className="size-3.5" strokeWidth={1.75} /> {describeTrigger(a.trigger)}
            </p>
          </div>
          <Switch checked={a.enabled} onChange={onToggle} label={`${a.enabled ? "Disable" : "Enable"} ${a.name}`} />
        </div>

        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-3 block w-full text-left">
          <p className={cn("text-[14px] leading-relaxed text-ink-2", !expanded && "line-clamp-2")}>{a.instructions}</p>
        </button>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-3">
            <RunStatusBadge status={a.lastStatus} />
            {a.lastRunAt && <span>Ran {relativeTime(a.lastRunAt)}</span>}
            {a.enabled && a.nextRunAt && <span title={formatDateTime(a.nextRunAt)}>Next {relativeTime(a.nextRunAt)}</span>}
            {a.enabled && !a.nextRunAt && !isManual && <span>Watching for new email</span>}
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              loading={running}
              icon={<Play className="size-3.5 fill-current" />}
              onClick={async () => {
                setRunning(true);
                try {
                  await onRun();
                } finally {
                  setRunning(false);
                }
              }}
            >
              Run now
            </Button>
            <Button size="sm" variant="ghost" className="!px-2 text-ink-3 hover:text-bad" aria-label={`Delete ${a.name}`} onClick={onDelete}>
              <Trash className="size-4" strokeWidth={1.5} />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
