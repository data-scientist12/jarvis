import type { Card } from "@/lib/tools/types";

export type StepStatus =
  | "running" // spinner + shimmer
  | "verified" // green check
  | "done" // completed; nothing to verify (reads, lookups)
  | "unverified" // write action ran, but the post-check failed or was skipped
  | "failed" // red x
  | "approval" // waiting for the user
  | "denied";

export interface TimelineStep {
  id: string;
  tool: string;
  /** Present-tense label, e.g. "Sending email". */
  title: string;
  status: StepStatus;
  /** One-line result (ToolResult.summary). */
  summary?: string;
  evidence?: string;
  error?: string;
  suggestion?: string;
  input?: unknown;
  output?: unknown;
  durationMs?: number | null;
  card?: Card;
  /** Present while `status === "approval"`. */
  approvalId?: string;
  approvalReason?: string;
}
