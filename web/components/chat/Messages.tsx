"use client";

import { Fragment } from "react";
import { isToolUIPart, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { motion } from "motion/react";
import { ExternalLink } from "lucide-react";
import { ResultCard } from "@/components/cards/ResultCard";
import { stepFromToolPart } from "@/components/timeline/adapt";
import { Timeline } from "@/components/timeline/Timeline";
import type { TimelineStep } from "@/components/timeline/types";
import { cn } from "@/components/utils/cn";
import { Markdown } from "./Markdown";
import { ReviewBadge } from "./ReviewBadge";
import type { JarvisMessage, ReviewData } from "./types";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;
type Block =
  | { kind: "text"; key: string; text: string }
  | { kind: "tools"; key: string; steps: TimelineStep[] };

export function UserMessage({ message }: { message: JarvisMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  if (!text.trim()) return null;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[22px] rounded-br-lg bg-fill-strong px-4 py-2.5 text-[15.5px] leading-relaxed text-ink sm:max-w-[75%]">{text}</div>
    </motion.div>
  );
}

function buildBlocks(message: JarvisMessage, live: boolean): { blocks: Block[]; steps: TimelineStep[]; review?: ReviewData; runId?: string; sources: { url: string; title?: string }[] } {
  const blocks: Block[] = [];
  const allSteps: TimelineStep[] = [];
  const sources: { url: string; title?: string }[] = [];
  let review: ReviewData | undefined;
  let runId: string | undefined;

  message.parts.forEach((part, i) => {
    if (part.type === "text") {
      if (!part.text.trim()) return;
      blocks.push({ kind: "text", key: `t${i}`, text: part.text });
    } else if (isToolUIPart(part)) {
      let step = stepFromToolPart(part as AnyToolPart);
      // A step that is still "running" in a message that is no longer streaming was interrupted.
      if (!live && step.status === "running") step = { ...step, status: "failed", error: "This step didn't finish." };
      allSteps.push(step);
      const last = blocks[blocks.length - 1];
      if (last?.kind === "tools") last.steps.push(step);
      else blocks.push({ kind: "tools", key: `g${i}`, steps: [step] });
    } else if (part.type === "source-url") {
      sources.push({ url: part.url, title: part.title });
    } else if (part.type === "data-review") {
      review = part.data;
    } else if (part.type === "data-run") {
      runId = part.data.runId;
    }
  });
  return { blocks, steps: allSteps, review, runId, sources };
}

export function AssistantMessage({
  message,
  live,
  onApprove,
  onDeny,
}: {
  message: JarvisMessage;
  /** true while this is the message currently being streamed / awaiting approval */
  live: boolean;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}) {
  const { blocks, steps, review, runId, sources } = buildBlocks(message, live);
  const verified = steps.filter((s) => s.status === "verified").length;
  const checkable = steps.filter((s) => s.status === "verified" || s.status === "unverified" || s.status === "failed").length;
  if (blocks.length === 0 && !review) return null;

  return (
    <div className="space-y-3">
      {blocks.map((b) =>
        b.kind === "text" ? (
          <Markdown key={b.key}>{b.text}</Markdown>
        ) : (
          <Fragment key={b.key}>
            <Timeline steps={b.steps} onApprove={onApprove} onDeny={onDeny} />
            {b.steps
              .filter((s) => s.card && s.status !== "failed")
              .map((s) => (
                <ResultCard key={`${s.id}-card`} card={s.card!} />
              ))}
          </Fragment>
        ),
      )}

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {sources.slice(0, 6).map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-fill px-2.5 py-1 text-[12px] text-ink-2 hover:bg-fill-strong")}
            >
              <ExternalLink className="size-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{s.title || hostOf(s.url)}</span>
            </a>
          ))}
        </div>
      )}

      {review && !live && <ReviewBadge review={review} verified={verified} total={checkable} runId={runId} />}
    </div>
  );
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function ThinkingRow() {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-shimmer text-[15px]">Thinking…</span>
    </div>
  );
}
