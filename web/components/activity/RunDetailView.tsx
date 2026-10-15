"use client";

import Link from "next/link";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { ResultCard } from "@/components/cards/ResultCard";
import { Markdown } from "@/components/chat/Markdown";
import { ReviewBadge } from "@/components/chat/ReviewBadge";
import type { ReviewData, ReviewStatus } from "@/components/chat/types";
import { PageContainer } from "@/components/shell/PageHeader";
import { stepFromRunStep } from "@/components/timeline/adapt";
import { Timeline } from "@/components/timeline/Timeline";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError } from "@/components/utils/api";
import { formatDateTime } from "@/components/utils/format";
import { useApi } from "@/hooks/useApi";
import { RunStatusBadge } from "./RunStatusBadge";
import { SourceIcon, sourceLabel } from "./SourceIcon";
import type { RunDetail, RunStepRow } from "./types";

function toReview(run: RunDetail): ReviewData | null {
  if (run.status === "running") return null;
  const r = run.review;
  const status: ReviewStatus = (r?.status as ReviewStatus | undefined) ?? run.status;
  return { status, summary: r?.summary ?? "", missing: r?.missing ?? [] };
}

export function RunDetailView({ id }: { id: string }) {
  const { data, error, loading, refresh } = useApi<{ run: RunDetail; steps: RunStepRow[] }>(`/api/runs/${id}`, {
    interval: (d) => (!d || d.run.status === "running" ? 2000 : false),
  });

  if (error && !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <PageContainer>
        <Card>
          <EmptyState
            title={notFound ? "Run not found" : "Couldn't load this run"}
            description={notFound ? "It may have been removed." : error.message}
            action={
              <div className="flex gap-2">
                <Button variant="secondary" href="/activity">
                  Back to Activity
                </Button>
                {!notFound && <Button onClick={refresh}>Try again</Button>}
              </div>
            }
          />
        </Card>
      </PageContainer>
    );
  }

  if (loading || !data) {
    return (
      <PageContainer>
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-6 h-9 w-3/4" />
        <Skeleton className="mt-8 h-64 rounded-2xl" />
      </PageContainer>
    );
  }

  const { run, steps } = data;
  const timelineSteps = steps.map(stepFromRunStep);
  const verified = timelineSteps.filter((s) => s.status === "verified").length;
  const review = toReview(run);

  return (
    <PageContainer>
      <Link href="/activity" className="mb-5 inline-flex items-center gap-1.5 text-[14px] text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" strokeWidth={1.75} /> Activity
      </Link>

      <div className="flex items-start gap-4">
        <SourceIcon source={run.source} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] sm:text-[30px]">{run.goal}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-ink-3">
            <RunStatusBadge status={run.status} />
            <span>{sourceLabel(run.source)}</span>
            <span aria-hidden>·</span>
            <span>{formatDateTime(run.startedAt)}</span>
            <span aria-hidden>·</span>
            <span>
              {verified}/{timelineSteps.length} verified
            </span>
          </p>
        </div>
        {run.conversationId && (
          <Button size="sm" variant="secondary" href={`/chat/${run.conversationId}`} icon={<MessageSquare className="size-3.5" strokeWidth={1.75} />} className="hidden sm:inline-flex">
            Open chat
          </Button>
        )}
      </div>

      {review && <div className="mt-6"><ReviewBadge review={review} verified={verified} total={timelineSteps.length} /></div>}

      <section className="mt-8">
        <h2 className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Steps</h2>
        {timelineSteps.length === 0 ? (
          <Card>
            <EmptyState title={run.status === "running" ? "Getting started…" : "No steps recorded"} description={run.status === "running" ? "Steps will appear here as Jarvis works." : undefined} />
          </Card>
        ) : (
          <Timeline steps={timelineSteps} collapsible={false} />
        )}
      </section>

      {timelineSteps.some((s) => s.card && s.status !== "failed") && (
        <section className="mt-8 space-y-3">
          <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Results</h2>
          {timelineSteps
            .filter((s) => s.card && s.status !== "failed")
            .map((s) => (
              <ResultCard key={s.id} card={s.card!} />
            ))}
        </section>
      )}

      {run.finalText && (
        <section className="mt-8">
          <h2 className="mb-3 px-1 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Summary</h2>
          <Card className="p-5">
            <Markdown>{run.finalText}</Markdown>
          </Card>
        </section>
      )}
    </PageContainer>
  );
}
