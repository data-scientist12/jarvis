import type { UIMessage } from "ai";

export type RunStatus = "running" | "succeeded" | "partial" | "failed" | "needs_input";
export type ReviewStatus = Exclude<RunStatus, "running">;

export type ReviewData = { status: ReviewStatus; summary: string; missing: string[] };

/** Custom data parts streamed by /api/chat (see CONTRACTS.md). */
export type JarvisDataParts = {
  run: { runId: string; status: RunStatus };
  review: ReviewData;
};

export type JarvisMessage = UIMessage<unknown, JarvisDataParts>;
