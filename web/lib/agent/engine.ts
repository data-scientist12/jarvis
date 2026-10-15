import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { loadAgentContext } from "@/lib/agent/context";
import { executorModel, executorModelId, lowEffort } from "@/lib/agent/models";
import { getToolsForUser } from "@/lib/agent/registry";
import { createRun, finishRun, getRunForUser, getRunSteps, recordUsage, type FinalStatus, type Review } from "@/lib/agent/run";
import { heuristicReview, reviewRun, stepsForReview } from "@/lib/agent/review";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import type { JarvisUIMessage } from "@/lib/agent/types";

const MAX_STEPS = 15;
const MAX_HISTORY_MESSAGES = 40;
const CONVERSATION_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface ChatSession {
  user: { id: string; name: string; email: string };
}

function textOfMessage(m: UIMessage | undefined): string {
  if (!m) return "";
  return m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n").trim();
}

function lastUserGoal(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return textOfMessage(messages[i]);
  }
  return "";
}

function friendlyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/api key|incorrect api key|401/i.test(msg)) return "The AI service rejected the server credentials. Check the OpenAI API key.";
  if (/rate limit|429|quota/i.test(msg)) return "The AI service is rate limited right now. Try again in a moment.";
  if (/timeout|timed out|abort/i.test(msg)) return "That took too long and was stopped. Try a smaller request.";
  return "Something went wrong while running that. Please try again.";
}

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), { status, headers: { "content-type": "application/json" } });
}

/** Keep the most recent messages, starting on a user message so tool calls are never orphaned. */
function trimHistory(messages: UIMessage[]): UIMessage[] {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;
  let start = messages.length - MAX_HISTORY_MESSAGES;
  while (start < messages.length && messages[start].role !== "user") start++;
  return start >= messages.length ? messages.slice(-MAX_HISTORY_MESSAGES) : messages.slice(start);
}

/**
 * After an approval round-trip the client re-sends the assistant message that holds our `data-run` part.
 * Reuse that run (if it is still waiting on the user) so one task = one run with all its steps.
 */
async function resumeOrCreateRun(args: { userId: string; goal: string; conversationId: string; messages: UIMessage[] }): Promise<string> {
  const last = args.messages[args.messages.length - 1];
  if (last?.role === "assistant") {
    const part = last.parts.find((p) => p.type === "data-run") as { data?: { runId?: string } } | undefined;
    const prevId = part?.data?.runId;
    if (typeof prevId === "string" && /^[0-9a-f-]{36}$/i.test(prevId)) {
      const prev = await getRunForUser(args.userId, prevId);
      if (prev && prev.status === "needs_input" && prev.conversationId === args.conversationId) {
        await db.update(schema.run).set({ status: "running", finishedAt: null }).where(eq(schema.run.id, prev.id));
        return prev.id;
      }
    }
  }
  return createRun({ userId: args.userId, source: "chat", goal: args.goal, conversationId: args.conversationId });
}

export async function streamChat(args: {
  session: ChatSession;
  conversationId: string;
  messages: UIMessage[];
  timezone?: string | null;
}): Promise<Response> {
  const { session, conversationId, messages } = args;
  const userId = session.user.id;

  if (!CONVERSATION_ID.test(conversationId)) return jsonError(400, "invalid_conversation_id");
  if (!messages.length || messages[messages.length - 1] == null) return jsonError(400, "no_messages");

  // Conversation ownership + upsert.
  const [existing] = await db.select({ userId: schema.conversation.userId, title: schema.conversation.title })
    .from(schema.conversation).where(eq(schema.conversation.id, conversationId)).limit(1);
  if (existing && existing.userId !== userId) return jsonError(404, "not_found");
  const goal = lastUserGoal(messages) || "Continue";
  if (!existing) {
    await db.insert(schema.conversation).values({
      id: conversationId, userId, title: goal.replace(/\s+/g, " ").slice(0, 60) || "New chat", messages: [],
    }).onConflictDoNothing();
  } else if (existing.title === "New chat" && goal) {
    await db.update(schema.conversation).set({ title: goal.replace(/\s+/g, " ").slice(0, 60) })
      .where(and(eq(schema.conversation.id, conversationId), eq(schema.conversation.userId, userId)));
  }

  const { ctx, profile, granted, memories } = await loadAgentContext(userId, args.timezone);
  const modelId = executorModelId(profile.model);
  const runId = await resumeOrCreateRun({ userId, goal, conversationId, messages });
  const { tools, toolApproval } = getToolsForUser(ctx, { granted, autopilot: profile.autopilot, runId });
  const instructions = buildSystemPrompt({ ctx, granted, memories, autopilot: profile.autopilot, mode: "chat" });

  let modelMessages: ModelMessage[];
  try {
    modelMessages = await convertToModelMessages(trimHistory(messages), { tools });
  } catch (e) {
    await finishRun(runId, { status: "failed", finalText: null });
    console.warn("[engine] convertToModelMessages failed:", e instanceof Error ? e.message : e);
    return jsonError(400, "invalid_messages");
  }

  const stream = createUIMessageStream<JarvisUIMessage>({
    originalMessages: messages as JarvisUIMessage[],
    onError: friendlyError,
    execute: async ({ writer }) => {
      let streamError: string | null = null;
      const onStreamError = (e: unknown) => {
        console.error("[engine] stream error:", e instanceof Error ? e.message : e);
        streamError = friendlyError(e);
        return streamError;
      };
      writer.write({ type: "start" });
      writer.write({ type: "data-run", id: "run", data: { runId, status: "running" } });

      const result = streamText({
        model: executorModel(modelId),
        instructions,
        messages: modelMessages,
        tools,
        toolApproval,
        experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET || process.env.BETTER_AUTH_SECRET,
        stopWhen: isStepCount(MAX_STEPS),
        providerOptions: lowEffort,
        maxRetries: 2,
      });

      // Pump the model stream manually so our trailing data parts are strictly ordered after it.
      const ui = toUIMessageStream<typeof tools, JarvisUIMessage>({
        stream: result.stream,
        tools,
        sendStart: false,
        sendFinish: false,
        sendSources: true,
        onError: onStreamError,
      });
      const reader = ui.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writer.write(value);
        }
      } finally {
        reader.releaseLock();
      }

      // ── Post-run: usage, review, final run status ──
      let finalText = "";
      let pendingApproval: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      try {
        const [steps, usage] = await Promise.all([result.steps, result.totalUsage]);
        inputTokens = usage?.inputTokens ?? 0;
        outputTokens = usage?.outputTokens ?? 0;
        finalText = steps[steps.length - 1]?.text || steps.map((s) => s.text).filter(Boolean).join("\n");
        const last = steps[steps.length - 1];
        const req = last?.content.find((p) => p.type === "tool-approval-request" && !(p as { isAutomatic?: boolean }).isAutomatic) as
          | { toolCall: { toolName: string } } | undefined;
        if (req) pendingApproval = req.toolCall.toolName;
      } catch (e) {
        console.warn("[engine] could not read stream result:", e instanceof Error ? e.message : e);
      }
      await recordUsage(userId, modelId, { inputTokens, outputTokens });

      const stepRows = stepsForReview(await getRunSteps(runId));
      let review: Review;
      let reviewUsage = { inputTokens: 0, outputTokens: 0 };
      if (streamError && !finalText.trim() && !stepRows.length) {
        review = { status: "failed", summary: streamError, missing: [] };
      } else if (pendingApproval) {
        review = { status: "needs_input", summary: "Waiting for your approval to continue.", missing: [`Approval for ${pendingApproval}`] };
      } else if (!stepRows.length && finalText.length < 400) {
        // Pure Q&A: skip the reviewer model, it adds latency for no signal.
        review = heuristicReview(stepRows, finalText);
      } else {
        const r = await reviewRun({ goal, steps: stepRows, finalText });
        review = r.review;
        reviewUsage = r.usage;
      }
      if (reviewUsage.inputTokens || reviewUsage.outputTokens) await recordUsage(userId, "review", reviewUsage);

      await finishRun(runId, {
        status: review.status,
        review,
        finalText,
        usage: { inputTokens: inputTokens + reviewUsage.inputTokens, outputTokens: outputTokens + reviewUsage.outputTokens },
      });

      writer.write({ type: "data-review", id: "review", data: { status: review.status, summary: review.summary, missing: review.missing } });
      writer.write({ type: "data-run", id: "run", data: { runId, status: review.status } });
      writer.write({ type: "finish" });
    },
    onEnd: async ({ messages: finalMessages }) => {
      try {
        await db.update(schema.conversation)
          .set({ messages: finalMessages as unknown[], updatedAt: new Date() })
          .where(and(eq(schema.conversation.id, conversationId), eq(schema.conversation.userId, userId)));
      } catch (e) {
        console.error("[engine] failed to persist conversation:", e instanceof Error ? e.message : e);
      }
    },
  });

  return createUIMessageStreamResponse({ stream });
}

export interface HeadlessResult {
  runId: string;
  status: FinalStatus;
  text: string;
}

/**
 * Runs a goal with no human in the loop (automations / brief). Autopilot is forced ON because
 * the user pre-approved the automation. Pass `runId` if the run row was already created.
 */
export async function runHeadless(args: {
  userId: string;
  goal: string;
  source: "automation" | "brief";
  automationId?: string | null;
  runId?: string;
}): Promise<HeadlessResult> {
  const { userId, goal, source } = args;
  const runId = args.runId ?? (await createRun({ userId, source, goal, automationId: args.automationId }));
  try {
    const { ctx, profile, granted, memories } = await loadAgentContext(userId);
    const modelId = executorModelId(profile.model);
    const { tools } = getToolsForUser(ctx, { granted, autopilot: true, runId });
    const instructions = buildSystemPrompt({ ctx, granted, memories, autopilot: true, mode: "headless" });

    const res = await generateText({
      model: executorModel(modelId),
      instructions,
      prompt: goal,
      tools,
      stopWhen: isStepCount(MAX_STEPS),
      providerOptions: lowEffort,
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(270_000),
    });
    const text = res.text || res.steps.map((s) => s.text).filter(Boolean).join("\n");
    const inTok = res.totalUsage?.inputTokens ?? 0;
    const outTok = res.totalUsage?.outputTokens ?? 0;
    await recordUsage(userId, modelId, { inputTokens: inTok, outputTokens: outTok });

    const stepRows = stepsForReview(await getRunSteps(runId));
    const { review, usage } = await reviewRun({ goal, steps: stepRows, finalText: text });
    if (usage.inputTokens || usage.outputTokens) await recordUsage(userId, "review", usage);
    await finishRun(runId, {
      status: review.status,
      review,
      finalText: text,
      usage: { inputTokens: inTok + usage.inputTokens, outputTokens: outTok + usage.outputTokens },
    });
    return { runId, status: review.status, text };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[engine] headless run failed:", message);
    await finishRun(runId, {
      status: "failed",
      review: { status: "failed", summary: friendlyError(e), missing: [] },
      finalText: null,
    }).catch(() => {});
    return { runId, status: "failed", text: friendlyError(e) };
  }
}
