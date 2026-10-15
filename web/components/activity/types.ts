import type { RunStatus } from "@/components/chat/types";

export type RunSource = "chat" | "automation" | "brief";

export type RunReview = { status?: RunStatus; complete?: boolean; summary?: string; missing?: string[] } | null;

export type RunSummary = {
  id: string;
  source: RunSource;
  goal: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  stepCount: number;
  verifiedCount: number;
  review: RunReview;
};

export type RunDetail = RunSummary & {
  finalText?: string | null;
  conversationId?: string | null;
  automationId?: string | null;
};

export type RunStepRow = {
  id: string;
  tool: string;
  title: string;
  status: "running" | "verified" | "done" | "failed";
  verified: boolean | null;
  evidence: string | null;
  input: unknown;
  output: unknown;
  durationMs: number | null;
  createdAt: string;
};
