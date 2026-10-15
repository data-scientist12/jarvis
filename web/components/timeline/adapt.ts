import { getToolName, type DynamicToolUIPart, type ToolUIPart } from "ai";
import type { ToolResult } from "@/lib/tools/types";
import { toolTitle } from "./toolMeta";
import type { TimelineStep } from "./types";

export function isToolResult(o: unknown): o is ToolResult {
  return !!o && typeof o === "object" && typeof (o as ToolResult).ok === "boolean" && typeof (o as ToolResult).summary === "string";
}

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

/** Maps an AI SDK v7 tool part (`tool-<name>` / `dynamic-tool`) onto the timeline's visual states. */
export function stepFromToolPart(part: AnyToolPart): TimelineStep {
  const tool = getToolName(part);
  const base: TimelineStep = {
    id: part.toolCallId,
    tool,
    title: part.title || toolTitle(tool),
    status: "running",
    input: part.input,
  };

  switch (part.state) {
    case "input-streaming":
    case "input-available":
      return base;
    case "approval-requested":
      if (part.approval.isAutomatic) return base;
      return { ...base, status: "approval", approvalId: part.approval.id, approvalReason: part.approval.requestReason };
    case "approval-responded":
      return part.approval.approved ? base : { ...base, status: "denied" };
    case "output-denied":
      return { ...base, status: "denied", error: part.approval.reason };
    case "output-error":
      return { ...base, status: "failed", error: part.errorText };
    case "output-available": {
      const out = part.output;
      if (isToolResult(out)) {
        if (!out.ok) {
          return { ...base, status: "failed", summary: out.summary, error: out.error, suggestion: out.suggestion, output: out };
        }
        return {
          ...base,
          status: out.verified === true ? "verified" : out.verified === false ? "unverified" : "done",
          summary: out.summary,
          evidence: out.evidence,
          output: out,
          card: out.card,
        };
      }
      return { ...base, status: "done", output: out };
    }
    default:
      return base;
  }
}

type RunStepRow = {
  id: string;
  tool: string;
  title?: string | null;
  status: "running" | "verified" | "done" | "failed" | string;
  verified?: boolean | null;
  evidence?: string | null;
  input?: unknown;
  output?: unknown;
  durationMs?: number | null;
};

/** Maps a `GET /api/runs/:id` step row onto the same visual states. */
export function stepFromRunStep(row: RunStepRow): TimelineStep {
  const out = isToolResult(row.output) ? row.output : undefined;
  let status: TimelineStep["status"];
  if (row.status === "running") status = "running";
  else if (row.status === "failed" || (out && !out.ok)) status = "failed";
  else if (row.status === "verified" || row.verified === true || out?.verified === true) status = "verified";
  else if (row.verified === false || out?.verified === false) status = "unverified";
  else status = "done";

  return {
    id: row.id,
    tool: row.tool,
    title: row.title || toolTitle(row.tool),
    status,
    summary: out?.summary,
    evidence: row.evidence ?? out?.evidence,
    error: status === "failed" ? (out?.error ?? out?.summary) : undefined,
    suggestion: out?.suggestion,
    input: row.input,
    output: row.output,
    durationMs: row.durationMs,
    card: out?.card,
  };
}
