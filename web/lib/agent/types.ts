import type { UIMessage } from "ai";
import type { FinalStatus } from "@/lib/agent/run";

/** Custom data parts streamed alongside the assistant message (`data-run`, `data-review`). */
export type JarvisDataParts = {
  run: { runId: string; status: "running" | FinalStatus };
  review: { status: FinalStatus; summary: string; missing: string[] };
};

export type JarvisUIMessage = UIMessage<unknown, JarvisDataParts>;
