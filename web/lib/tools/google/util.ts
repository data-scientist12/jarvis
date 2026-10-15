import { ZodError } from "zod";
import { google } from "googleapis";
import type { ToolContext, ToolResult } from "@/lib/tools/types";
import { fail } from "@/lib/tools/types";

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/** Throw inside a tool body to return an `invalid_input` failure. */
export class InputError extends Error {
  suggestion?: string;
  constructor(message: string, suggestion?: string) {
    super(message);
    this.suggestion = suggestion;
  }
}

/** Throw inside a tool body to short-circuit with a specific failure result. */
export class ToolFailure extends Error {
  result: ToolResult;
  constructor(result: ToolResult) {
    super(result.summary);
    this.result = result;
  }
}

interface GoogleErrorShape {
  code?: number | string;
  status?: number | string;
  message?: string;
  errors?: { reason?: string; message?: string }[];
  response?: {
    status?: number;
    data?: {
      error?:
        | string
        | {
            code?: number;
            message?: string;
            status?: string;
            errors?: { reason?: string; message?: string }[];
            details?: { reason?: string }[];
          };
      error_description?: string;
    };
  };
}

const CONNECTOR_LABEL: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Calendar",
  meet: "Meet",
  drive: "Drive, Docs & Sheets",
  tasks: "Tasks",
  contacts: "Contacts",
};

/** Maps any thrown value (googleapis, zod, our own) to a ToolResult failure. Never throws. */
export function mapError(err: unknown, connector: string): ToolResult {
  if (err instanceof ToolFailure) return err.result;
  if (err instanceof InputError) return fail(err.message, "invalid_input", err.suggestion ?? "Fix the input and try again.");
  if (err instanceof ZodError) {
    const issue = err.issues[0];
    return fail(`Invalid input: ${issue?.path.join(".") || "input"} ${issue?.message ?? ""}`.trim(), "invalid_input", "Fix the input and try again.");
  }

  const e = (typeof err === "object" && err !== null ? err : { message: String(err) }) as GoogleErrorShape;
  if (e.code === "google_not_connected") {
    return fail(e.message ?? "Google account is not connected.", "google_not_connected", "Ask the user to reconnect Google on the Connectors page.");
  }

  const apiErr = typeof e.response?.data?.error === "object" ? e.response.data.error : undefined;
  const rawStatus = e.response?.status ?? apiErr?.code ?? (typeof e.code === "number" ? e.code : undefined) ?? e.status;
  const status = typeof rawStatus === "string" ? Number(rawStatus) || undefined : rawStatus;
  const reasons = new Set<string>();
  for (const r of e.errors ?? []) if (r.reason) reasons.add(r.reason);
  for (const r of apiErr?.errors ?? []) if (r.reason) reasons.add(r.reason);
  for (const r of apiErr?.details ?? []) if (r.reason) reasons.add(r.reason);
  if (apiErr?.status) reasons.add(apiErr.status);
  const message = apiErr?.message ?? e.errors?.[0]?.message ?? e.message ?? "Unknown Google API error";
  const lower = message.toLowerCase();
  const rawErr = typeof e.response?.data?.error === "string" ? e.response.data.error : undefined;
  const label = CONNECTOR_LABEL[connector] ?? connector;

  if (rawErr === "invalid_grant" || e.message === "invalid_grant" || status === 401) {
    return fail(`Google rejected the credentials (${message}).`, "google_not_connected", "Reconnect Google on the Connectors page.");
  }
  if (
    reasons.has("insufficientPermissions") ||
    reasons.has("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("insufficient permission")
  ) {
    return fail(`The ${label} permission has not been granted.`, "scope_missing", `Ask the user to grant ${connector} on the Connectors page.`);
  }
  if (reasons.has("accessNotConfigured") || reasons.has("SERVICE_DISABLED") || lower.includes("has not been used in project") || lower.includes("api has not been")) {
    return fail(`Google API not enabled: ${message}`, "upstream_error", "A Google Cloud API is disabled for this project. Tell the user; do not retry.");
  }
  if (status === 429 || reasons.has("rateLimitExceeded") || reasons.has("userRateLimitExceeded") || reasons.has("RESOURCE_EXHAUSTED") || reasons.has("quotaExceeded")) {
    return fail("Google rate limit hit.", "rate_limited", "Wait a few seconds and retry with a smaller batch.");
  }
  if (status === 404) return fail(`Not found: ${message}`, "not_found", "Check the id, or search again to find the right one.");
  if (status === 409 || reasons.has("alreadyExists") || reasons.has("duplicate")) return fail(`Conflict: ${message}`, "conflict", "The item changed or already exists. Re-read it and retry.");
  if (status === 400 || reasons.has("invalid") || reasons.has("invalidArgument") || reasons.has("INVALID_ARGUMENT") || reasons.has("badRequest")) {
    return fail(`Google rejected the request: ${message}`, "invalid_input", "Check the arguments (ids, dates, ranges) and retry.");
  }
  if (status === 403) return fail(`Google denied access: ${message}`, "upstream_error", "The user may not have access to this item.");
  return fail(`${label} request failed: ${message}`, "upstream_error", "Retry once; if it fails again report the problem.");
}

/** Runs a tool body and converts every exception into a ToolResult. */
export async function guard(connector: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return mapError(err, connector);
  }
}

/** True when an error from googleapis is an HTTP error with this status. */
export function httpStatus(err: unknown): number | undefined {
  const e = err as GoogleErrorShape;
  const s = e?.response?.status ?? (typeof e?.code === "number" ? e.code : undefined) ?? e?.status;
  return typeof s === "string" ? Number(s) || undefined : s;
}

/* -------------------------------------------------------------------------- */
/* Clients                                                                    */
/* -------------------------------------------------------------------------- */

export async function gmailClient(ctx: ToolContext) {
  return google.gmail({ version: "v1", auth: await ctx.google() });
}
export async function calendarClient(ctx: ToolContext) {
  return google.calendar({ version: "v3", auth: await ctx.google() });
}
export async function driveClient(ctx: ToolContext) {
  return google.drive({ version: "v3", auth: await ctx.google() });
}
export async function docsClient(ctx: ToolContext) {
  return google.docs({ version: "v1", auth: await ctx.google() });
}
export async function sheetsClient(ctx: ToolContext) {
  return google.sheets({ version: "v4", auth: await ctx.google() });
}
export async function tasksClient(ctx: ToolContext) {
  return google.tasks({ version: "v1", auth: await ctx.google() });
}
export async function peopleClient(ctx: ToolContext) {
  return google.people({ version: "v1", auth: await ctx.google() });
}
export async function meetClient(ctx: ToolContext) {
  return google.meet({ version: "v2", auth: await ctx.google() });
}

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}… [truncated, ${s.length - n} more chars]` : s;
}

export function short(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

const EMAIL_RE = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

export function looksLikeEmail(s: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/.test(s.trim());
}

/** Extracts unique lowercase email addresses from a header value or free text ("Name <a@b.com>, c@d.com"). */
export function extractEmails(s: string | null | undefined): string[] {
  if (!s) return [];
  return uniq((s.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()));
}

/** Parses user-supplied recipients; throws InputError when any entry has no valid address. */
export function cleanEmails(list: string[] | undefined, field: string): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const raw of list) {
    const found = extractEmails(raw);
    if (found.length === 0) {
      throw new InputError(`"${raw}" in ${field} is not an email address.`, "Resolve names to emails with contacts_search first.");
    }
    out.push(...found);
  }
  return uniq(out);
}

/** Name part of a "Name <email>" header, falling back to the address. */
export function displayName(header: string): string {
  const m = header.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>/);
  const n = m?.[1]?.trim();
  if (n) return n;
  return extractEmails(header)[0] ?? header.trim();
}

export function b64urlEncode(data: Buffer | string): string {
  return Buffer.from(data).toString("base64url");
}
export function b64urlDecode(data: string): Buffer {
  return Buffer.from(data, "base64url");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Escapes a value for use inside single quotes in a Drive `q` expression. */
export function escapeDriveQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Blocks obvious SSRF targets for URLs that come from untrusted email headers. */
export function isSafePublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\[/.test(h) || h.includes(":")) return false; // IPv6 literals
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Time helpers (all wall-clock math happens in the user's IANA timezone)     */
/* -------------------------------------------------------------------------- */

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function localParts(d: Date, tz: string): LocalParts {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(d)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Offset (local - UTC) in ms at instant d. */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Interprets a wall-clock time in tz and returns the real instant (DST-safe). */
export function zonedToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

export interface ParsedWhen {
  date: Date;
  /** true when the input was a bare YYYY-MM-DD */
  dateOnly: boolean;
}

/**
 * Accepts "2026-10-16T16:00:00" (local, interpreted in tz), "2026-10-16T16:00:00+05:30" / "...Z" (absolute),
 * or "2026-10-16" (local midnight). Throws InputError otherwise.
 */
export function parseWhen(input: string, tz: string): ParsedWhen {
  const s = input.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { date: zonedToDate(+m[1], +m[2], +m[3], 0, 0, 0, tz), dateOnly: true };
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /T|\s\d/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return { date: d, dateOnly: false };
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (m) return { date: zonedToDate(+m[1], +m[2], +m[3], +m[4], +m[5], m[6] ? +m[6] : 0, tz), dateOnly: false };
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return { date: d, dateOnly: false };
  throw new InputError(`Could not understand the date/time "${input}".`, "Use ISO format like 2026-10-16T16:00:00 (local time) or 2026-10-16.");
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function formatOffset(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  const abs = Math.abs(Math.round(ms / 60000));
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Local ISO string with offset, e.g. 2026-10-16T16:00:00+05:30. */
export function toLocalISO(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${formatOffset(tzOffsetMs(d, tz))}`;
}

/** Converts a Google start/end ({dateTime}|{date}) to local ISO (or the plain date for all-day). */
export function googleTimeToLocal(t: { dateTime?: string | null; date?: string | null } | undefined | null, tz: string): string {
  if (!t) return "";
  if (t.dateTime) return toLocalISO(new Date(t.dateTime), tz);
  return t.date ?? "";
}

export function localDateStr(d: Date, tz: string): string {
  const p = localParts(d, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Instant of local midnight at the start of dateStr (YYYY-MM-DD). */
export function dayStart(dateStr: string, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return zonedToDate(y, m, d, 0, 0, 0, tz);
}

/** Instant for HH:MM wall-clock on dateStr. */
export function atTime(dateStr: string, minutesOfDay: number, tz: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return zonedToDate(y, m, d, Math.floor(minutesOfDay / 60), minutesOfDay % 60, 0, tz);
}

/** 0 = Sunday ... 6 = Saturday for a YYYY-MM-DD string. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function parseHM(s: string): number {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new InputError(`"${s}" is not a HH:MM time.`);
  const mins = +m[1] * 60 + +m[2];
  if (mins < 0 || mins > 24 * 60) throw new InputError(`"${s}" is out of range.`);
  return mins;
}

/** "Fri, Oct 16, 4:00 PM" in tz. */
export function formatHuman(d: Date, tz: string, opts: { time?: boolean } = { time: true }): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(opts.time === false ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(d);
}

/** Date part (YYYY-MM-DD) in the user's timezone for any accepted input form. */
export function localDateOf(input: string, tz: string): string {
  const w = parseWhen(input, tz);
  return localDateStr(w.date, tz);
}

/* -------------------------------------------------------------------------- */
/* MIME                                                                       */
/* -------------------------------------------------------------------------- */

const noCrlf = (s: string) => s.replace(/[\r\n]+/g, " ");

/** RFC 2047 encoded-word for non-ASCII header text. */
export function encodeHeaderText(text: string): string {
  const t = noCrlf(text);
  if (/^[\x20-\x7e]*$/.test(t)) return t;
  const words: string[] = [];
  let cur = "";
  for (const ch of Array.from(t)) {
    if (Buffer.byteLength(cur + ch, "utf8") > 42) {
      words.push(cur);
      cur = "";
    }
    cur += ch;
  }
  if (cur) words.push(cur);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

function wrap76(b64: string): string {
  return b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface MimeInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
}

/** Builds an RFC 2822 message (UTF-8, base64 body parts). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** RFC 2045 quoted-printable for UTF-8 text with CRLF line breaks (soft-wraps at 76 chars). */
export function quotedPrintable(input: string): string {
  return input
    .split("\r\n")
    .map((line) => {
      let encoded = "";
      for (const byte of Buffer.from(line, "utf8")) {
        const ch = String.fromCharCode(byte);
        encoded += (byte >= 33 && byte <= 126 && ch !== "=") || byte === 32 ? ch : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`;
      }
      // Trailing whitespace must be encoded.
      encoded = encoded.replace(/ $/, "=20");
      const out: string[] = [];
      while (encoded.length > 76) {
        let cut = 75;
        // Don't split an =XX escape.
        const eq = encoded.lastIndexOf("=", cut);
        if (eq > cut - 3) cut = eq;
        out.push(encoded.slice(0, cut) + "=");
        encoded = encoded.slice(cut);
      }
      out.push(encoded);
      return out.join("\r\n");
    })
    .join("\r\n");
}

export function buildMime(i: MimeInput): Buffer {
  const headers: string[] = ["MIME-Version: 1.0"];
  if (i.to.length) headers.push(`To: ${i.to.map(noCrlf).join(", ")}`);
  if (i.cc?.length) headers.push(`Cc: ${i.cc.map(noCrlf).join(", ")}`);
  if (i.bcc?.length) headers.push(`Bcc: ${i.bcc.map(noCrlf).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderText(i.subject)}`);
  if (i.inReplyTo) headers.push(`In-Reply-To: ${noCrlf(i.inReplyTo)}`);
  if (i.references) headers.push(`References: ${noCrlf(i.references)}`);

  // Match what Gmail's own composer sends: multipart/alternative (text + HTML), quoted-printable.
  // A base64-encoded, text-only body is a common spam signal.
  const altBoundary = `jarvis_alt_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const text = i.body.replace(/\r?\n/g, "\r\n");
  const html = `<div dir="ltr">${escapeHtml(i.body).replace(/\r?\n/g, "<br>\r\n")}</div>`;
  const textPart =
    `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
    `--${altBoundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${quotedPrintable(text)}\r\n` +
    `--${altBoundary}\r\nContent-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${quotedPrintable(html)}\r\n` +
    `--${altBoundary}--`;

  if (!i.attachments?.length) {
    return Buffer.from(`${headers.join("\r\n")}\r\n${textPart}\r\n`, "utf8");
  }
  const boundary = `jarvis_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [`--${boundary}\r\n${textPart}\r\n`];
  for (const a of i.attachments) {
    const fname = encodeHeaderText(a.filename).replace(/"/g, "'");
    const safeType = a.mimeType.replace(/[\r\n]/g, "") || "application/octet-stream";
    parts.push(
      `--${boundary}\r\nContent-Type: ${safeType}; name="${fname}"\r\nContent-Disposition: attachment; filename="${fname}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(a.data.toString("base64"))}\r\n`,
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${parts.join("")}`, "utf8");
}
