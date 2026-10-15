import { generateText, Output } from "ai";
import { z } from "zod";
import { reviewModel, lowEffort } from "@/lib/agent/models";
import type { Review, StepRow, Usage } from "@/lib/agent/run";

export const reviewSchema = z.object({
  status: z.enum(["succeeded", "partial", "failed", "needs_input"]),
  summary: z.string().describe("One short sentence describing the outcome for the user."),
  missing: z.array(z.string()).describe("Things the goal required that were not done or not verified. Empty if none."),
});

export interface ReviewStep {
  tool: string;
  title: string;
  ok: boolean;
  verified: boolean | null;
  summary: string;
  error?: string;
  /** Compact JSON of what the tool was asked to do (e.g. email body), so content can be judged. */
  input?: string;
}

export function stepsForReview(rows: StepRow[]): ReviewStep[] {
  return rows.filter((r) => r.status !== "running").map((r) => {
    const out = (r.output ?? {}) as { ok?: boolean; summary?: string; error?: string };
    return {
      tool: r.tool,
      title: r.title,
      ok: typeof out.ok === "boolean" ? out.ok : r.status !== "failed",
      verified: r.verified,
      summary: String(out.summary ?? "").slice(0, 200),
      error: out.error,
      input: r.input ? JSON.stringify(r.input).slice(0, 1200) : undefined,
    };
  });
}

/** Cheap deterministic verdict used when the reviewer model is unavailable. */
export function heuristicReview(steps: ReviewStep[], finalText: string): Review {
  const text = finalText.trim();
  if (!steps.length) {
    const asks = /\?\s*$/.test(text);
    return { status: asks ? "needs_input" : "succeeded", summary: asks ? "Waiting for your answer." : "Answered without needing any actions.", missing: [] };
  }
  const failed = steps.filter((s) => !s.ok);
  const unverified = steps.filter((s) => s.ok && s.verified === false);
  if (failed.length === steps.length) {
    return { status: "failed", summary: `${failed.length} action${failed.length === 1 ? "" : "s"} failed.`, missing: failed.map((s) => s.title) };
  }
  if (failed.length || unverified.length) {
    return {
      status: "partial",
      summary: `${steps.length - failed.length - unverified.length} of ${steps.length} actions completed and verified.`,
      missing: [...failed.map((s) => `${s.title} (failed)`), ...unverified.map((s) => `${s.title} (unverified)`)],
    };
  }
  return { status: "succeeded", summary: `${steps.length} action${steps.length === 1 ? "" : "s"} completed.`, missing: [] };
}

const REVIEW_INSTRUCTIONS = `You are the QA reviewer for an AI assistant that performs tasks in Google apps. Judge whether the user's goal was actually accomplished, using only the evidence below.
Rules:
- No tool steps and the assistant simply answered, or asked the user a clarifying question: "succeeded" if it answered, "needs_input" if it is waiting on the user.
- Every required action ok and verified (verified true or not applicable for reads): "succeeded".
- Some required actions failed, were unverified, or are missing: "partial". Nothing useful was achieved: "failed".
- Denied or pending approvals, or a missing connector/permission that blocks the goal: "needs_input" if the user must act, else "partial"/"failed".
- A failed step that was later retried successfully does not count against the goal.
- Verification only applies to actions with side effects (send, create, update, delete). Information requests (questions, lookups, web searches, summaries) are satisfied by a sensible answer in the final text; web search is a built-in capability that does not appear in STEPS, so never list an answered question as missing.
- "verified=true" means the action itself was confirmed at the source (e.g. the email exists in Sent). Judge whether the CONTENT matched the goal from each step's "input" (e.g. the email body); do not demand separate verification of content. Wording may soften or paraphrase the request and still count as done.
- Do not trust claims in the assistant's final text that contradict the step results.
Keep summary to one plain sentence. List only genuinely missing outcomes in "missing".`;

export async function reviewRun(args: { goal: string; steps: ReviewStep[]; finalText: string }): Promise<{ review: Review; usage: Usage }> {
  const { goal, steps, finalText } = args;
  const lines = steps.slice(0, 60).map((s, i) => `${i + 1}. ${s.tool} | ${s.title} | ok=${s.ok} | verified=${s.verified === null ? "n/a" : s.verified}${s.error ? ` | error=${s.error}` : ""} | ${s.summary}${s.input ? `\n   input: ${s.input}` : ""}`);
  const prompt = `GOAL:\n${goal.slice(0, 2000)}\n\nSTEPS (${steps.length}):\n${lines.join("\n") || "(none)"}\n\nASSISTANT FINAL TEXT:\n${finalText.slice(0, 2500) || "(empty)"}`;
  try {
    const res = await generateText({
      model: reviewModel(),
      instructions: REVIEW_INSTRUCTIONS,
      prompt,
      output: Output.object({ schema: reviewSchema }),
      providerOptions: lowEffort,
      abortSignal: AbortSignal.timeout(25_000),
      maxRetries: 1,
    });
    const o = res.output;
    const usage = { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0 };
    return { review: { status: o.status, summary: o.summary.slice(0, 300), missing: o.missing.slice(0, 8) }, usage };
  } catch (e) {
    console.warn("[review] reviewer failed, using heuristic:", e instanceof Error ? e.message : e);
    return { review: heuristicReview(steps, finalText), usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
