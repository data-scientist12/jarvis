import { tool, type ToolSet, type ToolApprovalConfiguration } from "ai";
import { openai } from "@/lib/agent/openai";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { GoogleNotConnectedError } from "@/lib/google/client";
import type { Connector } from "@/lib/auth/scopes";
import { fail, type JarvisTool, type ToolContext, type ToolResult } from "@/lib/tools/types";
import { coreTools } from "@/lib/tools/core";
import { googleTools } from "@/lib/tools/google";

const TOOL_TIMEOUT_MS = 45_000;
const MAX_STORED_BYTES = 20_000;
const MAX_MODEL_BYTES = 14_000;

export interface StepEvent {
  stepId: string;
  tool: string;
  title: string;
  phase: "start" | "end";
  ok?: boolean;
  verified?: boolean;
}

export interface ToolsOptions {
  granted: Connector[];
  autopilot: boolean;
  runId: string;
  onStep?: (e: StepEvent) => void;
}

export const allJarvisTools: JarvisTool[] = [...coreTools, ...googleTools];

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}

function errorToResult(err: unknown): ToolResult {
  if (err instanceof GoogleNotConnectedError) {
    return fail("Google isn't connected", "google_not_connected", "Tell the user to connect Google on the Connectors page.");
  }
  const e = err as { code?: number | string; status?: number; message?: string; response?: { status?: number } };
  const status = Number(e?.status ?? e?.response?.status ?? (typeof e?.code === "number" ? e.code : NaN));
  const msg = e?.message ?? "Unexpected error";
  if (status === 401 || status === 403) {
    if (/insufficient|scope|permission/i.test(msg)) return fail("Google permission missing", "scope_missing", "Ask the user to reconnect that Google connector on the Connectors page.");
    if (/rate|quota/i.test(msg)) return fail("Google rate limit hit", "rate_limited", "Wait a moment, then retry once.");
    return fail("Google denied access", "scope_missing", "Ask the user to reconnect Google on the Connectors page.");
  }
  if (status === 404) return fail("Not found", "not_found", "Check the id or search again.");
  if (status === 429) return fail("Rate limited by Google", "rate_limited", "Wait a moment, then retry once.");
  return fail(`Tool failed: ${msg.slice(0, 200)}`, "upstream_error", "Try once more or take a different approach.");
}

function clip<T>(value: T, maxBytes: number): T | string {
  try {
    const s = JSON.stringify(value);
    if (s === undefined || s.length <= maxBytes) return value;
    return s.slice(0, maxBytes) + "…[truncated]";
  } catch {
    return "[unserializable]";
  }
}

function toStored(r: ToolResult): Record<string, unknown> {
  return {
    ok: r.ok,
    summary: r.summary,
    error: r.error,
    suggestion: r.suggestion,
    verified: r.verified,
    evidence: r.evidence,
    data: clip(r.data, MAX_STORED_BYTES),
    card: clip(r.card, MAX_STORED_BYTES),
  };
}

/** What the model sees: no UI card, bounded size. */
function toModelValue(r: ToolResult): Record<string, unknown> {
  const out: Record<string, unknown> = { ok: r.ok, summary: r.summary };
  if (r.error) out.error = r.error;
  if (r.suggestion) out.suggestion = r.suggestion;
  if (r.verified !== undefined) out.verified = r.verified;
  if (r.evidence) out.evidence = r.evidence;
  if (r.data !== undefined) out.data = clip(r.data, MAX_MODEL_BYTES);
  return out;
}

function safeTitle(jt: JarvisTool, input: unknown): string {
  try {
    return jt.title(input);
  } catch {
    return jt.name;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ms);
  });
  try {
    return await Promise.race([p, t]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runWrapped(
  jt: JarvisTool,
  input: unknown,
  ctx: ToolContext,
  opts: ToolsOptions,
  toolCallId: string | undefined,
  failures: Map<string, number>,
): Promise<ToolResult> {
  const key = `${jt.name}:${stableStringify(input)}`;
  const title = safeTitle(jt, input);
  const started = Date.now();

  if ((failures.get(key) ?? 0) >= 2) {
    const skipped = fail("Skipped: repeated failure", "conflict", "This exact call already failed twice. Change the approach or ask the user.");
    try {
      await db.insert(schema.runStep).values({
        runId: opts.runId, toolCallId, tool: jt.name, title, input: (input ?? {}) as Record<string, unknown>,
        output: toStored(skipped), status: "failed", verified: false, durationMs: 0,
      });
    } catch { /* never block on bookkeeping */ }
    return skipped;
  }

  let stepId = "";
  try {
    const [row] = await db.insert(schema.runStep).values({
      runId: opts.runId, toolCallId, tool: jt.name, title, input: (input ?? {}) as Record<string, unknown>, status: "running",
    }).returning({ id: schema.runStep.id });
    stepId = row.id;
  } catch (e) {
    console.warn("[registry] could not insert run_step:", e instanceof Error ? e.message : e);
  }
  opts.onStep?.({ stepId, tool: jt.name, title, phase: "start" });

  let result: ToolResult;
  try {
    const r = await withTimeout(Promise.resolve().then(() => jt.execute(input, { ...ctx, now: new Date() })), TOOL_TIMEOUT_MS);
    result = r === "timeout" ? fail("Timed out after 45s", "upstream_error", "The service is slow. Retry once or tell the user.") : r;
  } catch (err) {
    result = errorToResult(err);
  }
  if (!result || typeof result.ok !== "boolean") {
    result = fail("Tool returned an invalid result", "upstream_error");
  }

  if (!result.ok) failures.set(key, (failures.get(key) ?? 0) + 1);

  const status: "verified" | "done" | "failed" = !result.ok ? "failed" : result.verified === true ? "verified" : result.verified === undefined ? "done" : "failed";
  if (stepId) {
    try {
      await db.update(schema.runStep).set({
        status,
        verified: result.verified ?? null,
        evidence: result.evidence ?? null,
        output: toStored(result),
        durationMs: Date.now() - started,
      }).where(eq(schema.runStep.id, stepId));
    } catch (e) {
      console.warn("[registry] could not update run_step:", e instanceof Error ? e.message : e);
    }
  }
  opts.onStep?.({ stepId, tool: jt.name, title, phase: "end", ok: result.ok, verified: result.verified });
  return result;
}

/**
 * Builds the AI SDK tool set for a run plus the matching `toolApproval` policy.
 * Pass BOTH to `streamText` / `generateText` (and the same `tools` to `convertToModelMessages`).
 */
export function getToolsForUser(ctx: ToolContext, opts: ToolsOptions): { tools: ToolSet; toolApproval: ToolApprovalConfiguration<ToolSet, never> } {
  const granted = new Set<string>(opts.granted);
  const failures = new Map<string, number>();
  const tools: ToolSet = {};
  const approval: Record<string, "user-approval"> = {};

  for (const jt of allJarvisTools) {
    if (jt.connector !== "core" && !granted.has(jt.connector)) continue;
    tools[jt.name] = tool({
      description: jt.description,
      inputSchema: jt.inputSchema,
      execute: async (input, options) => runWrapped(jt, input, ctx, opts, options?.toolCallId, failures),
      toModelOutput: ({ output }) => ({ type: "json", value: toModelValue(output as ToolResult) as never }),
    });
    if (jt.risk === "high" && !opts.autopilot) approval[jt.name] = "user-approval";
  }

  // OpenAI hosted web search (provider-executed; no approval, no run_step).
  tools.web_search = openai.tools.webSearch({ searchContextSize: "low", externalWebAccess: true });

  return { tools, toolApproval: approval as ToolApprovalConfiguration<ToolSet, never> };
}
