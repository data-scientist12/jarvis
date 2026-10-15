"use client";

import Link from "next/link";
import { useState } from "react";
import { motion } from "motion/react";
import { Activity as ActivityIcon, ChevronRight } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { relativeTime } from "@/components/utils/format";
import { useApi } from "@/hooks/useApi";
import { RunStatusBadge } from "./RunStatusBadge";
import { SourceIcon, sourceLabel } from "./SourceIcon";
import type { RunSummary } from "./types";

type Filter = "all" | "chat" | "automation";

function duration(r: RunSummary) {
  if (!r.finishedAt) return null;
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms < 1000 ? "<1s" : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;
}

export function RunRow({ run }: { run: RunSummary }) {
  const d = duration(run);
  return (
    <Link href={`/activity/${run.id}`} className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-fill sm:px-5">
      <SourceIcon source={run.source} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] font-medium leading-snug">{run.goal}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-3">
          <span>{sourceLabel(run.source)}</span>
          <span aria-hidden>·</span>
          <span>{relativeTime(run.startedAt)}</span>
          {run.stepCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className={run.verifiedCount === run.stepCount ? "text-[#1f8a3b] dark:text-ok" : undefined}>
                {run.verifiedCount}/{run.stepCount} verified
              </span>
            </>
          )}
          {d && (
            <>
              <span aria-hidden>·</span>
              <span>{d}</span>
            </>
          )}
        </p>
      </div>
      <RunStatusBadge status={run.status} />
      <ChevronRight className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
    </Link>
  );
}

export function ActivityView() {
  const [filter, setFilter] = useState<Filter>("all");
  const url = `/api/runs?limit=50${filter === "all" ? "" : `&source=${filter}`}`;
  const { data, loading, error, refresh } = useApi<{ runs: RunSummary[] }>(url, {
    interval: (d) => (d?.runs.some((r) => r.status === "running") ? 2000 : false),
  });
  const runs = data?.runs ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Activity"
        subtitle="Everything Jarvis has done for you, with proof."
        actions={
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: "All" },
              { value: "chat", label: "Chats" },
              { value: "automation", label: "Automations" },
            ]}
          />
        }
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="divide-y divide-hairline">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3.5 px-5 py-4">
                <Skeleton className="size-10 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error && !data ? (
          <EmptyState title="Couldn't load activity" description={error.message} action={<Button variant="secondary" onClick={refresh}>Try again</Button>} />
        ) : runs.length === 0 ? (
          <EmptyState icon={<ActivityIcon />} title="Nothing here yet" description="When Jarvis does something for you, it shows up here with every step." action={<Button href="/dashboard">Ask Jarvis</Button>} />
        ) : (
          <motion.ul initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.03 } } }} className="divide-y divide-hairline">
            {runs.map((r) => (
              <motion.li key={r.id} variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
                <RunRow run={r} />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </Card>
    </PageContainer>
  );
}
