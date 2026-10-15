import type { z } from "zod";
import type { OAuth2Client } from "google-auth-library";
import type { Connector } from "@/lib/auth/scopes";

/**
 * CONTRACT shared by connectors (lib/tools/**), the agent engine (lib/agent/**) and the UI (components/**).
 * Do not change shapes without updating CONTRACTS.md.
 */

export type Risk = "read" | "write" | "high";

/** Card payloads the UI renders for tool results. Keep fields small and display-ready. */
export type Card =
  | { type: "event"; title: string; start: string; end: string; meetLink?: string; htmlLink?: string; attendees?: string[]; location?: string }
  | { type: "event_list"; events: { id: string; title: string; start: string; end: string; meetLink?: string; htmlLink?: string }[] }
  | { type: "email"; to: string[]; subject: string; body: string; status: "sent" | "draft" | "replied"; link?: string }
  | { type: "email_list"; emails: { id: string; threadId: string; from: string; subject: string; snippet: string; date: string; unread: boolean }[]; query?: string }
  | { type: "doc"; title: string; url: string; kind: "doc" | "sheet" | "slides" | "folder" | "file"; thumbnail?: string }
  | { type: "file_list"; files: { id: string; title: string; url: string; kind: string; modified?: string }[] }
  | { type: "task"; title: string; due?: string; list?: string; status: "created" | "completed" }
  | { type: "task_list"; tasks: { id: string; title: string; due?: string; status: string }[] }
  | { type: "contact"; people: { name: string; emails: string[]; phones: string[] }[] }
  | { type: "meet"; url: string; title?: string }
  | { type: "bulk"; action: string; count: number; items?: string[] }
  | { type: "note"; title: string; text: string };

export interface ToolResult<T = unknown> {
  ok: boolean;
  /** One line shown in the activity timeline, e.g. "Event “Demo sync” created for Fri 4:00 PM". */
  summary: string;
  /** Data the model needs to continue (ids, links...). Keep it compact. */
  data?: T;
  /** Machine-readable error code, e.g. "contact_not_found", "scope_missing", "google_not_connected". */
  error?: string;
  /** Hint for the model on how to recover. */
  suggestion?: string;
  /** undefined = not checked; true = post-condition confirmed by re-reading from the source; false = check failed. */
  verified?: boolean;
  /** Human-readable proof of verification, e.g. "Gmail message 18f… has label SENT". */
  evidence?: string;
  card?: Card;
}

export interface ToolContext {
  userId: string;
  userName: string;
  userEmail: string;
  /** IANA timezone of the user, e.g. "Asia/Kolkata". */
  timezone: string;
  now: Date;
  /** Lazily creates an authenticated Google OAuth2 client (throws GoogleNotConnectedError). */
  google: () => Promise<OAuth2Client>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tools are stored heterogeneously in arrays
export interface JarvisTool<I = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  risk: Risk;
  /** Which connector must be granted for this tool to be offered. "core" = always. */
  connector: Connector | "core";
  /** Short present-tense title for the timeline: "Sending email to Priya". */
  title: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<ToolResult>;
}

export function defineTool<I>(t: JarvisTool<I>): JarvisTool<I> {
  return t;
}

/** Helpers for tool authors. */
export const ok = (summary: string, extra: Omit<ToolResult, "ok" | "summary"> = {}): ToolResult => ({ ok: true, summary, ...extra });
export const fail = (summary: string, error: string, suggestion?: string, data?: unknown): ToolResult => ({ ok: false, summary, error, suggestion, data, verified: false });
