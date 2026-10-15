import { z } from "zod";
import { Readable } from "node:stream";
import type { gmail_v1 } from "googleapis";
import { defineTool, fail, ok, type Card, type JarvisTool, type ToolContext, type ToolResult } from "@/lib/tools/types";
import {
  InputError,
  ToolFailure,
  b64urlDecode,
  b64urlEncode,
  buildMime,
  chunk,
  cleanEmails,
  displayName,
  extractEmails,
  gmailClient,
  driveClient,
  guard,
  htmlToText,
  isSafePublicHttpsUrl,
  mapError,
  mapLimit,
  short,
  toLocalISO,
  truncate,
  uniq,
  type MimeAttachment,
} from "./util";
import { downloadDriveFile, driveKind, findOrCreateFolder } from "./drive";

type Gmail = gmail_v1.Gmail;
type Msg = gmail_v1.Schema$Message;
type Part = gmail_v1.Schema$MessagePart;

const META_HEADERS = ["From", "To", "Cc", "Subject", "Date"];
const mailLink = (threadId: string) => `https://mail.google.com/mail/u/0/#all/${threadId}`;

/* ------------------------------ shared helpers ----------------------------- */

function hdr(msg: Msg | undefined, name: string): string {
  const n = name.toLowerCase();
  return msg?.payload?.headers?.find((h) => h.name?.toLowerCase() === n)?.value ?? "";
}

interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  date: string;
  unread: boolean;
  labels: string[];
}

function summarize(m: Msg, tz: string): MailSummary {
  const ms = Number(m.internalDate ?? 0);
  const labels = m.labelIds ?? [];
  return {
    id: m.id ?? "",
    threadId: m.threadId ?? "",
    from: hdr(m, "From"),
    to: hdr(m, "To"),
    subject: hdr(m, "Subject") || "(no subject)",
    snippet: short(m.snippet ?? "", 160),
    date: ms ? toLocalISO(new Date(ms), tz) : hdr(m, "Date"),
    unread: labels.includes("UNREAD"),
    labels,
  };
}

function emailListCard(items: MailSummary[], query?: string): Card {
  return {
    type: "email_list",
    query,
    emails: items.map((e) => ({ id: e.id, threadId: e.threadId, from: e.from, subject: e.subject, snippet: e.snippet, date: e.date, unread: e.unread })),
  };
}

async function fetchMetadata(gmail: Gmail, ids: string[], headers: string[] = META_HEADERS): Promise<Msg[]> {
  const res = await mapLimit(ids, 10, async (id) => {
    try {
      const r = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: headers });
      return r.data;
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) return null;
      throw err;
    }
  });
  return res.filter((m): m is Msg => m !== null);
}

async function listMessageIds(gmail: Gmail, opts: { q?: string; labelIds?: string[]; max: number; includeSpamTrash?: boolean }): Promise<{ ids: string[]; more: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let more = false;
  do {
    const r = await gmail.users.messages.list({
      userId: "me",
      q: opts.q || undefined,
      labelIds: opts.labelIds,
      includeSpamTrash: opts.includeSpamTrash ?? false,
      maxResults: Math.min(500, opts.max - ids.length),
      pageToken,
    });
    for (const m of r.data.messages ?? []) if (m.id) ids.push(m.id);
    pageToken = r.data.nextPageToken ?? undefined;
    if (ids.length >= opts.max) {
      more = Boolean(pageToken);
      break;
    }
  } while (pageToken);
  return { ids, more };
}

async function myAddress(gmail: Gmail): Promise<string> {
  const r = await gmail.users.getProfile({ userId: "me" });
  return (r.data.emailAddress ?? "").toLowerCase();
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  attachmentId: string;
  size: number;
}

interface ParsedBody {
  text: string;
  attachments: AttachmentInfo[];
}

function parseBody(payload: Part | undefined): ParsedBody {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: AttachmentInfo[] = [];
  const walk = (p: Part) => {
    const mime = p.mimeType ?? "";
    if (p.filename && p.body?.attachmentId) {
      attachments.push({ filename: p.filename, mimeType: mime, attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
    } else if (mime === "text/plain" && p.body?.data) {
      plain.push(b64urlDecode(p.body.data).toString("utf8"));
    } else if (mime === "text/html" && p.body?.data) {
      html.push(b64urlDecode(p.body.data).toString("utf8"));
    }
    for (const c of p.parts ?? []) walk(c);
  };
  if (payload) walk(payload);
  const text = plain.length ? plain.join("\n").trim() : htmlToText(html.join("\n"));
  return { text, attachments };
}

async function resolveLabel(gmail: Gmail, name: string, create: boolean): Promise<{ id: string; name: string; created: boolean } | null> {
  const r = await gmail.users.labels.list({ userId: "me" });
  const n = name.trim().toLowerCase();
  const hit = (r.data.labels ?? []).find((l) => l.id?.toLowerCase() === n || l.name?.toLowerCase() === n);
  if (hit?.id) return { id: hit.id, name: hit.name ?? name, created: false };
  if (!create) return null;
  const c = await gmail.users.labels.create({
    userId: "me",
    requestBody: { name: name.trim(), labelListVisibility: "labelShow", messageListVisibility: "show" },
  });
  if (!c.data.id) throw new Error("Gmail did not return the new label id");
  return { id: c.data.id, name: c.data.name ?? name, created: true };
}

async function sendRaw(gmail: Gmail, raw: Buffer, threadId?: string): Promise<Msg> {
  if (raw.length < 2_500_000) {
    const r = await gmail.users.messages.send({ userId: "me", requestBody: { raw: b64urlEncode(raw), threadId } });
    return r.data;
  }
  const r = await gmail.users.messages.send({
    userId: "me",
    requestBody: threadId ? { threadId } : undefined,
    media: { mimeType: "message/rfc822", body: Readable.from(raw) },
  });
  return r.data;
}

async function verifySent(gmail: Gmail, id: string, expectThreadId?: string): Promise<{ verified: boolean; evidence: string; threadId: string }> {
  const r = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Subject"] });
  const labels = r.data.labelIds ?? [];
  const threadId = r.data.threadId ?? "";
  const sent = labels.includes("SENT");
  const threadOk = !expectThreadId || threadId === expectThreadId;
  return {
    verified: sent && threadOk,
    threadId,
    evidence: sent
      ? `Gmail message ${id} has label SENT${expectThreadId ? (threadOk ? ` in thread ${threadId}` : `, but thread ${threadId} differs from ${expectThreadId}`) : ""}`
      : `Gmail message ${id} does not have label SENT (labels: ${labels.join(", ") || "none"})`,
  };
}

async function collectDriveAttachments(ctx: ToolContext, ids: string[] | undefined): Promise<MimeAttachment[]> {
  if (!ids?.length) return [];
  const drive = await driveClient(ctx);
  const out: MimeAttachment[] = [];
  let budget = 15 * 1024 * 1024;
  for (const id of ids) {
    try {
      const f = await downloadDriveFile(drive, id, budget);
      budget -= f.data.length;
      out.push({ filename: f.filename, mimeType: f.mimeType, data: f.data });
    } catch (err) {
      if (err instanceof InputError || err instanceof ToolFailure) throw err;
      throw new ToolFailure(mapError(err, "drive"));
    }
  }
  return out;
}

const emailsField = (what: string) => z.array(z.string()).describe(what);

/* --------------------------------- search ---------------------------------- */

const gmailSearch = defineTool({
  name: "gmail_search",
  description:
    "Search the user's Gmail with Gmail query syntax (from:, to:, subject:, is:unread, has:attachment, newer_than:7d, label:, in:inbox). Use first to find emails before reading, replying or acting. Returns id, threadId, from, subject, snippet, date, unread.",
  risk: "read",
  connector: "gmail",
  inputSchema: z.object({
    query: z.string().describe("Gmail search query, e.g. 'is:unread in:inbox newer_than:2d' or 'from:priya subject:agenda'. Empty = latest mail."),
    max: z.number().int().min(1).max(50).default(15).describe("Max results (1-50)."),
  }),
  title: (i) => `Searching Gmail for “${short(i.query || "latest mail", 50)}”`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const { ids } = await listMessageIds(gmail, { q: input.query, max: input.max });
      const msgs = await fetchMetadata(gmail, ids);
      const items = msgs.map((m) => summarize(m, ctx.timezone));
      return ok(items.length ? `Found ${items.length} email${items.length === 1 ? "" : "s"} for “${short(input.query, 50)}”` : `No emails match “${short(input.query, 50)}”`, {
        data: { count: items.length, emails: items },
        card: emailListCard(items, input.query),
      });
    }),
});

/* ---------------------------------- read ----------------------------------- */

const gmailRead = defineTool({
  name: "gmail_read",
  description: "Read one email in full (headers, plain-text body, attachment list, link). Use after gmail_search when the snippet is not enough, or before replying.",
  risk: "read",
  connector: "gmail",
  inputSchema: z.object({ messageId: z.string().describe("Gmail message id from gmail_search.") }),
  title: () => "Reading an email",
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const r = await gmail.users.messages.get({ userId: "me", id: input.messageId, format: "full" });
      const m = r.data;
      const s = summarize(m, ctx.timezone);
      const { text, attachments } = parseBody(m.payload ?? undefined);
      const body = truncate(text, 8000);
      return ok(`Read “${s.subject}” from ${displayName(s.from)}`, {
        data: {
          id: s.id,
          threadId: s.threadId,
          from: s.from,
          to: s.to,
          cc: hdr(m, "Cc"),
          replyTo: hdr(m, "Reply-To"),
          subject: s.subject,
          date: s.date,
          labels: s.labels,
          body,
          attachments,
          link: mailLink(s.threadId),
        },
      });
    }),
});

const gmailReadThread = defineTool({
  name: "gmail_read_thread",
  description: "Read a whole email conversation (all messages, oldest first). Use to summarize a conversation or find what was agreed before replying.",
  risk: "read",
  connector: "gmail",
  inputSchema: z.object({ threadId: z.string().describe("Gmail thread id (threadId from gmail_search).") }),
  title: () => "Reading an email thread",
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const r = await gmail.users.threads.get({ userId: "me", id: input.threadId, format: "full" });
      const all = r.data.messages ?? [];
      const msgs = all.slice(-15);
      const out = msgs.map((m) => {
        const { text, attachments } = parseBody(m.payload ?? undefined);
        const s = summarize(m, ctx.timezone);
        return {
          id: s.id,
          from: s.from,
          to: s.to,
          date: s.date,
          subject: s.subject,
          body: truncate(text.replace(/\n>.*$/gm, "").trim(), 3000),
          attachments: attachments.map((a) => a.filename),
        };
      });
      const subject = out[0]?.subject ?? "(no subject)";
      return ok(`Read thread “${subject}” (${all.length} message${all.length === 1 ? "" : "s"})`, {
        data: { threadId: input.threadId, subject, totalMessages: all.length, shownMessages: out.length, messages: out, link: mailLink(input.threadId) },
      });
    }),
});

/* ---------------------------------- send ----------------------------------- */

const gmailSend = defineTool({
  name: "gmail_send",
  description:
    "Send a new email from the user's Gmail (optionally with Drive files attached). Use only when the user clearly asked to send. Resolve people's names to addresses with contacts_search first. For replies use gmail_reply instead.",
  risk: "high",
  connector: "gmail",
  inputSchema: z.object({
    to: emailsField("Recipient email addresses (plain addresses, 1-50)."),
    subject: z.string().min(1).describe("Subject line."),
    body: z.string().min(1).describe("Plain-text email body."),
    cc: emailsField("CC addresses.").optional(),
    bcc: emailsField("BCC addresses.").optional(),
    driveAttachmentIds: z.array(z.string()).max(10).optional().describe("Drive file ids to attach (Docs export as PDF, Sheets as XLSX). Total cap 15MB."),
  }),
  title: (i) => `Sending email “${short(i.subject, 40)}” to ${short(i.to.join(", "), 40)}`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const to = cleanEmails(input.to, "to");
      if (!to.length) throw new InputError("At least one recipient is required.");
      const cc = cleanEmails(input.cc, "cc");
      const bcc = cleanEmails(input.bcc, "bcc");
      const attachments = await collectDriveAttachments(ctx, input.driveAttachmentIds);
      const gmail = await gmailClient(ctx);
      const raw = buildMime({ to, cc, bcc, subject: input.subject, body: input.body, attachments });
      const sent = await sendRaw(gmail, raw);
      if (!sent.id) return fail("Gmail did not return a message id for the sent email.", "upstream_error", "Check the Sent folder before retrying so you do not send twice.");
      const v = await verifySent(gmail, sent.id);
      return {
        ok: v.verified,
        summary: v.verified ? `Email “${short(input.subject, 50)}” sent to ${to.join(", ")}` : `Email “${short(input.subject, 50)}” may not have been sent`,
        data: { messageId: sent.id, threadId: v.threadId, to, cc, bcc, attachments: attachments.map((a) => a.filename), link: mailLink(v.threadId) },
        verified: v.verified,
        evidence: v.evidence,
        error: v.verified ? undefined : "upstream_error",
        suggestion: v.verified ? undefined : "Search Sent mail before retrying to avoid duplicates.",
        card: { type: "email", to, subject: input.subject, body: truncate(input.body, 600), status: "sent", link: mailLink(v.threadId) },
      } satisfies ToolResult;
    }),
});

interface ReplyPlan {
  threadId: string;
  to: string[];
  cc: string[];
  subject: string;
  inReplyTo: string;
  references: string;
  origSubject: string;
}

async function planReply(gmail: Gmail, messageId: string, replyAll: boolean): Promise<ReplyPlan> {
  const [orig, me] = await Promise.all([
    gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Reply-To", "Subject", "Message-ID", "Message-Id", "References"] }),
    myAddress(gmail),
  ]);
  const m = orig.data;
  const from = extractEmails(hdr(m, "From"));
  const replyTo = extractEmails(hdr(m, "Reply-To"));
  const origTo = extractEmails(hdr(m, "To"));
  const origCc = extractEmails(hdr(m, "Cc"));
  const fromMe = from.includes(me);
  const primary = fromMe ? origTo : replyTo.length ? replyTo : from;
  let to = primary.filter((e) => e !== me);
  let cc: string[] = [];
  if (replyAll) {
    cc = [...origTo, ...origCc, ...(fromMe ? [] : from)].filter((e) => e !== me && !to.includes(e));
    cc = uniq(cc);
  }
  if (!to.length) to = primary;
  if (!to.length) throw new InputError("Could not work out who to reply to from this message.");
  const subj = hdr(m, "Subject") || "(no subject)";
  const msgId = hdr(m, "Message-ID");
  const refs = [hdr(m, "References"), msgId].filter(Boolean).join(" ").trim();
  return {
    threadId: m.threadId ?? "",
    to,
    cc,
    subject: /^re:/i.test(subj) ? subj : `Re: ${subj}`,
    inReplyTo: msgId,
    references: refs,
    origSubject: subj,
  };
}

const gmailReply = defineTool({
  name: "gmail_reply",
  description:
    "Reply to an existing email in the same thread (sends immediately). Use when the user asks to reply/respond. Read the message first with gmail_read. Use gmail_draft_reply instead if the user wants to review before sending.",
  risk: "high",
  connector: "gmail",
  inputSchema: z.object({
    messageId: z.string().describe("Id of the message being replied to."),
    body: z.string().min(1).describe("Plain-text reply body (no quoted text needed)."),
    replyAll: z.boolean().default(false).describe("Reply to everyone on the original message."),
  }),
  title: () => "Replying to an email",
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const plan = await planReply(gmail, input.messageId, input.replyAll);
      const raw = buildMime({ to: plan.to, cc: plan.cc, subject: plan.subject, body: input.body, inReplyTo: plan.inReplyTo, references: plan.references });
      const sent = await sendRaw(gmail, raw, plan.threadId || undefined);
      if (!sent.id) return fail("Gmail did not return a message id for the reply.", "upstream_error", "Check the thread before retrying.");
      const v = await verifySent(gmail, sent.id, plan.threadId || undefined);
      return {
        ok: v.verified,
        summary: v.verified ? `Replied to “${short(plan.origSubject, 50)}” (${plan.to.join(", ")})` : `Reply to “${short(plan.origSubject, 50)}” could not be confirmed`,
        data: { messageId: sent.id, threadId: v.threadId, to: plan.to, cc: plan.cc, link: mailLink(v.threadId) },
        verified: v.verified,
        evidence: v.evidence,
        error: v.verified ? undefined : "upstream_error",
        suggestion: v.verified ? undefined : "Check the thread before retrying to avoid duplicate replies.",
        card: { type: "email", to: plan.to, subject: plan.subject, body: truncate(input.body, 600), status: "replied", link: mailLink(v.threadId) },
      } satisfies ToolResult;
    }),
});

/* --------------------------------- drafts ---------------------------------- */

async function verifyDraft(gmail: Gmail, draftId: string, expectThreadId?: string): Promise<{ verified: boolean; evidence: string }> {
  const r = await gmail.users.drafts.get({ userId: "me", id: draftId, format: "metadata" });
  const ok1 = Boolean(r.data.id) && Boolean(r.data.message?.id);
  const threadOk = !expectThreadId || r.data.message?.threadId === expectThreadId;
  return {
    verified: ok1 && threadOk,
    evidence: ok1 ? `Gmail draft ${draftId} exists${expectThreadId ? (threadOk ? ` in thread ${expectThreadId}` : " but in a different thread") : ""}` : `Draft ${draftId} was not found when re-read`,
  };
}

const gmailCreateDraft = defineTool({
  name: "gmail_create_draft",
  description: "Create an email draft in Gmail without sending. Use when the user wants to review before sending, or to bulk-prepare emails safely.",
  risk: "write",
  connector: "gmail",
  inputSchema: z.object({
    to: emailsField("Recipient email addresses."),
    subject: z.string().min(1).describe("Subject line."),
    body: z.string().min(1).describe("Plain-text body."),
    cc: emailsField("CC addresses.").optional(),
  }),
  title: (i) => `Drafting email “${short(i.subject, 40)}”`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const to = cleanEmails(input.to, "to");
      const cc = cleanEmails(input.cc, "cc");
      if (!to.length) throw new InputError("At least one recipient is required.");
      const gmail = await gmailClient(ctx);
      const raw = buildMime({ to, cc, subject: input.subject, body: input.body });
      const d = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: b64urlEncode(raw) } } });
      if (!d.data.id) return fail("Gmail did not create the draft.", "upstream_error", "Retry once.");
      const v = await verifyDraft(gmail, d.data.id);
      return {
        ok: v.verified,
        summary: `Draft “${short(input.subject, 50)}” saved for ${to.join(", ")}`,
        data: { draftId: d.data.id, messageId: d.data.message?.id, to, link: "https://mail.google.com/mail/u/0/#drafts" },
        verified: v.verified,
        evidence: v.evidence,
        card: { type: "email", to, subject: input.subject, body: truncate(input.body, 600), status: "draft", link: "https://mail.google.com/mail/u/0/#drafts" },
      } satisfies ToolResult;
    }),
});

const gmailDraftReply = defineTool({
  name: "gmail_draft_reply",
  description: "Create a draft reply in the same thread without sending. Use for bulk triage ('draft replies to my unread emails') or when the user wants to review the reply first.",
  risk: "write",
  connector: "gmail",
  inputSchema: z.object({
    messageId: z.string().describe("Id of the message being replied to."),
    body: z.string().min(1).describe("Plain-text reply body."),
  }),
  title: () => "Drafting a reply",
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const plan = await planReply(gmail, input.messageId, false);
      const raw = buildMime({ to: plan.to, subject: plan.subject, body: input.body, inReplyTo: plan.inReplyTo, references: plan.references });
      const d = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw: b64urlEncode(raw), threadId: plan.threadId || undefined } } });
      if (!d.data.id) return fail("Gmail did not create the draft.", "upstream_error", "Retry once.");
      const v = await verifyDraft(gmail, d.data.id, plan.threadId || undefined);
      return {
        ok: v.verified,
        summary: `Draft reply to “${short(plan.origSubject, 50)}” saved`,
        data: { draftId: d.data.id, threadId: plan.threadId, to: plan.to, link: "https://mail.google.com/mail/u/0/#drafts" },
        verified: v.verified,
        evidence: v.evidence,
        card: { type: "email", to: plan.to, subject: plan.subject, body: truncate(input.body, 600), status: "draft", link: "https://mail.google.com/mail/u/0/#drafts" },
      } satisfies ToolResult;
    }),
});

/* ------------------------------- bulk actions ------------------------------ */

const BULK_ACTIONS = ["archive", "mark_read", "mark_unread", "star", "unstar", "important", "trash", "add_label", "remove_label"] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

const LABEL_EFFECTS: Record<Exclude<BulkAction, "trash" | "add_label" | "remove_label">, { add?: string[]; remove?: string[] }> = {
  archive: { remove: ["INBOX"] },
  mark_read: { remove: ["UNREAD"] },
  mark_unread: { add: ["UNREAD"] },
  star: { add: ["STARRED"] },
  unstar: { remove: ["STARRED"] },
  important: { add: ["IMPORTANT"] },
};

/** Applies add/remove label ids to many messages; verifies a sample. Shared by bulk action and unsubscribe. */
async function applyLabels(gmail: Gmail, ids: string[], add: string[], remove: string[]): Promise<{ sampleOk: boolean; checked: number; subjects: string[] }> {
  for (const part of chunk(ids, 1000)) {
    await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids: part, addLabelIds: add, removeLabelIds: remove } });
  }
  const sample = ids.slice(0, 5);
  const msgs = await fetchMetadata(gmail, sample, ["Subject"]);
  let good = 0;
  for (const m of msgs) {
    const l = m.labelIds ?? [];
    if (add.every((x) => l.includes(x)) && remove.every((x) => !l.includes(x))) good++;
  }
  return { sampleOk: msgs.length > 0 && good === msgs.length, checked: msgs.length, subjects: msgs.map((m) => hdr(m, "Subject") || "(no subject)") };
}

const gmailBulkAction = defineTool({
  name: "gmail_bulk_action",
  description:
    "Act on many emails at once: archive, mark read/unread, star, mark important, trash, add/remove a label. Give either a Gmail query (e.g. 'in:inbox category:promotions older_than:7d') or explicit messageIds. Use for inbox cleanup and triage. Preview with gmail_search first when the query is broad.",
  risk: "high",
  connector: "gmail",
  inputSchema: z.object({
    query: z.string().optional().describe("Gmail search query selecting the messages. Required unless messageIds is given."),
    messageIds: z.array(z.string()).max(500).optional().describe("Explicit message ids (alternative to query)."),
    action: z.enum(BULK_ACTIONS).describe("What to do to every selected message."),
    label: z.string().optional().describe("Label name for add_label / remove_label (created if missing for add_label)."),
    max: z.number().int().min(1).max(500).default(100).describe("Max messages to affect (default 100, cap 500)."),
  }),
  title: (i) => `${i.action.replace("_", " ")} emails${i.query ? ` matching “${short(i.query, 40)}”` : ""}`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const hasQuery = Boolean(input.query?.trim());
      if (!hasQuery && !input.messageIds?.length) throw new InputError("Provide a non-empty query or messageIds.", "Refusing to act on the whole mailbox.");
      if ((input.action === "add_label" || input.action === "remove_label") && !input.label?.trim()) throw new InputError("`label` is required for add_label/remove_label.");

      let ids: string[];
      let more = false;
      if (input.messageIds?.length) {
        ids = uniq(input.messageIds).slice(0, input.max);
      } else {
        const r = await listMessageIds(gmail, { q: input.query, max: input.max });
        ids = r.ids;
        more = r.more;
      }
      if (!ids.length) return ok("No emails matched, nothing changed", { data: { count: 0 }, verified: true, evidence: "Query returned 0 messages", card: { type: "bulk", action: input.action, count: 0 } });

      let sampleOk = false;
      let evidence = "";
      let subjects: string[] = [];
      let failures = 0;
      let done = ids.length;
      let verb: string;

      if (input.action === "trash") {
        verb = "Trashed";
        const results = await mapLimit(ids, 10, async (id) => {
          try {
            await gmail.users.messages.trash({ userId: "me", id });
            return true;
          } catch (err) {
            if ((err as { response?: { status?: number } })?.response?.status === 429) throw err;
            return false;
          }
        });
        failures = results.filter((r) => !r).length;
        done = ids.length - failures;
        const sample = ids.slice(0, 5);
        const msgs = await fetchMetadata(gmail, sample, ["Subject"]);
        const good = msgs.filter((m) => (m.labelIds ?? []).includes("TRASH")).length;
        sampleOk = msgs.length > 0 && good === msgs.length && failures === 0;
        subjects = msgs.map((m) => hdr(m, "Subject") || "(no subject)");
        evidence = `${good}/${msgs.length} sampled messages now carry label TRASH`;
      } else {
        let add: string[] = [];
        let remove: string[] = [];
        if (input.action === "add_label" || input.action === "remove_label") {
          const lbl = await resolveLabel(gmail, input.label as string, input.action === "add_label");
          if (!lbl) return fail(`Label “${input.label}” does not exist.`, "not_found", "Use gmail_list_labels to see available labels.");
          if (input.action === "add_label") add = [lbl.id];
          else remove = [lbl.id];
          verb = input.action === "add_label" ? `Labeled “${lbl.name}”` : `Removed label “${lbl.name}” from`;
        } else {
          const eff = LABEL_EFFECTS[input.action];
          add = eff.add ?? [];
          remove = eff.remove ?? [];
          verb = { archive: "Archived", mark_read: "Marked read", mark_unread: "Marked unread", star: "Starred", unstar: "Unstarred", important: "Marked important" }[input.action];
        }
        const r = await applyLabels(gmail, ids, add, remove);
        sampleOk = r.sampleOk;
        subjects = r.subjects;
        evidence = `Re-read ${r.checked} sampled messages: label changes ${r.sampleOk ? "confirmed" : "NOT confirmed"} (+[${add.join(",")}] -[${remove.join(",")}])`;
      }

      const summary = `${verb} ${done} email${done === 1 ? "" : "s"}${more ? " (more matched; raise max or run again)" : ""}${failures ? `, ${failures} failed` : ""}`;
      return {
        ok: failures === 0,
        summary,
        data: { action: input.action, count: done, failed: failures, moreMatchingAvailable: more, sampleSubjects: subjects },
        verified: sampleOk,
        evidence,
        error: failures ? "upstream_error" : undefined,
        suggestion: failures ? "Some messages failed; retry the same query." : undefined,
        card: { type: "bulk", action: input.action.replace("_", " "), count: done, items: subjects },
      } satisfies ToolResult;
    }),
});

/* ------------------------------ follow-up scan ----------------------------- */

const gmailFindUnreplied = defineTool({
  name: "gmail_find_unreplied",
  description:
    "Find sent emails nobody has replied to yet (threads from the last 30 days where the user wrote last, older than N days). Use for follow-up reminders and 'who owes me a reply'. Pair with gmail_create_draft or tasks_create_many.",
  risk: "read",
  connector: "gmail",
  inputSchema: z.object({
    days: z.number().int().min(1).max(30).default(3).describe("Only threads where the user's last message is at least this many days old."),
    max: z.number().int().min(1).max(50).default(20).describe("Max follow-up candidates."),
  }),
  title: (i) => `Finding emails waiting on a reply (${i.days}+ days)`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const me = await myAddress(gmail);
      const list = await gmail.users.threads.list({ userId: "me", q: "in:sent newer_than:30d", maxResults: 100 });
      const threadIds = (list.data.threads ?? []).map((t) => t.id).filter((x): x is string => Boolean(x));
      const cutoff = ctx.now.getTime() - input.days * 86_400_000;
      const found: { summary: MailSummary; recipient: string; lastSentAt: string; daysWaiting: number }[] = [];
      for (const batch of chunk(threadIds, 20)) {
        const threads = await mapLimit(batch, 10, async (id) => {
          try {
            const r = await gmail.users.threads.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Subject", "Date"] });
            return r.data;
          } catch {
            return null;
          }
        });
        for (const t of threads) {
          const msgs = (t?.messages ?? []).filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
          const last = msgs[msgs.length - 1];
          if (!last) continue;
          const labels = last.labelIds ?? [];
          if (labels.includes("TRASH") || labels.includes("SPAM")) continue;
          const fromEmails = extractEmails(hdr(last, "From"));
          if (!(labels.includes("SENT") || fromEmails.includes(me))) continue;
          const sentMs = Number(last.internalDate ?? 0);
          if (!sentMs || sentMs > cutoff) continue;
          const recipients = extractEmails(hdr(last, "To")).filter((e) => e !== me);
          if (!recipients.length) continue;
          const s = summarize(last, ctx.timezone);
          found.push({
            summary: { ...s, from: `To: ${recipients.join(", ")}` },
            recipient: recipients.join(", "),
            lastSentAt: toLocalISO(new Date(sentMs), ctx.timezone),
            daysWaiting: Math.floor((ctx.now.getTime() - sentMs) / 86_400_000),
          });
        }
        if (found.length >= input.max) break;
      }
      found.sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt));
      const top = found.slice(0, input.max);
      return ok(top.length ? `${top.length} sent email${top.length === 1 ? "" : "s"} still waiting on a reply` : `No unanswered emails older than ${input.days} days`, {
        data: {
          count: top.length,
          candidates: top.map((f) => ({ messageId: f.summary.id, threadId: f.summary.threadId, recipient: f.recipient, subject: f.summary.subject, lastSentAt: f.lastSentAt, daysWaiting: f.daysWaiting, link: mailLink(f.summary.threadId) })),
        },
        card: emailListCard(top.map((f) => f.summary)),
      });
    }),
});

/* ------------------------------ subscriptions ------------------------------ */

interface UnsubInfo {
  url?: string;
  mailto?: string;
  oneClick: boolean;
}

function parseListUnsubscribe(listUnsub: string, post: string): UnsubInfo {
  const targets = [...listUnsub.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const https = targets.find((t) => /^https:\/\//i.test(t));
  const http = targets.find((t) => /^http:\/\//i.test(t));
  const mailto = targets.find((t) => /^mailto:/i.test(t));
  const url = https ?? http;
  return { url, mailto, oneClick: Boolean(https) && /list-unsubscribe\s*=\s*one-click/i.test(post) };
}

const gmailListSubscriptions = defineTool({
  name: "gmail_list_subscriptions",
  description: "List newsletters/marketing senders in the user's recent mail that offer an unsubscribe option, ranked by volume. Use to clean up inbox noise, then call gmail_unsubscribe for the senders the user picks.",
  risk: "read",
  connector: "gmail",
  inputSchema: z.object({
    days: z.number().int().min(1).max(90).default(30).describe("Look back this many days."),
    max: z.number().int().min(1).max(50).default(25).describe("Max senders to return."),
  }),
  title: () => "Scanning inbox for subscriptions",
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const q = `newer_than:${input.days}d -in:sent -in:chats (unsubscribe OR category:promotions OR category:updates OR category:forums)`;
      const { ids } = await listMessageIds(gmail, { q, max: 250 });
      const msgs = await fetchMetadata(gmail, ids, ["From", "Subject", "List-Unsubscribe", "List-Unsubscribe-Post"]);
      const groups = new Map<string, { sender: string; name: string; count: number; info: UnsubInfo; latestSubject: string }>();
      for (const m of msgs) {
        const lu = hdr(m, "List-Unsubscribe");
        if (!lu) continue;
        const from = hdr(m, "From");
        const email = extractEmails(from)[0];
        if (!email) continue;
        const g = groups.get(email);
        if (g) {
          g.count++;
        } else {
          groups.set(email, { sender: email, name: displayName(from), count: 1, info: parseListUnsubscribe(lu, hdr(m, "List-Unsubscribe-Post")), latestSubject: hdr(m, "Subject") });
        }
      }
      const rows = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, input.max);
      const data = rows.map((g) => ({ sender: g.sender, name: g.name, count: g.count, unsubscribeUrl: g.info.url, unsubscribeMailto: g.info.mailto, oneClick: g.info.oneClick, latestSubject: short(g.latestSubject, 80) }));
      return ok(rows.length ? `Found ${rows.length} subscription sender${rows.length === 1 ? "" : "s"} in the last ${input.days} days` : "No subscription senders found", {
        data: { scannedMessages: msgs.length, senders: data },
        card: { type: "bulk", action: "subscriptions found", count: rows.length, items: rows.slice(0, 15).map((g) => `${g.name} <${g.sender}> · ${g.count} email${g.count === 1 ? "" : "s"}${g.info.oneClick ? " · one-click" : ""}`) },
      });
    }),
});

const gmailUnsubscribe = defineTool({
  name: "gmail_unsubscribe",
  description:
    "Unsubscribe from a sender using its List-Unsubscribe header (one-click POST, or an unsubscribe email), then optionally archive their existing inbox mail. Use after gmail_list_subscriptions when the user confirms which senders to drop.",
  risk: "high",
  connector: "gmail",
  inputSchema: z.object({
    sender: z.string().describe("Sender email address (from gmail_list_subscriptions)."),
    archiveExisting: z.boolean().default(true).describe("Also archive this sender's mail currently in the inbox."),
  }),
  title: (i) => `Unsubscribing from ${short(i.sender, 40)}`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const email = extractEmails(input.sender)[0];
      if (!email) throw new InputError(`"${input.sender}" is not an email address.`);
      const gmail = await gmailClient(ctx);
      const { ids } = await listMessageIds(gmail, { q: `from:${email}`, max: 10 });
      const msgs = await fetchMetadata(gmail, ids, ["From", "Subject", "List-Unsubscribe", "List-Unsubscribe-Post"]);
      const withHeader = msgs.find((m) => hdr(m, "List-Unsubscribe"));
      if (!withHeader) {
        return fail(`No unsubscribe option found in recent mail from ${email}.`, "not_found", "Offer to archive or trash their mail with gmail_bulk_action instead, or create a filter manually.");
      }
      const info = parseListUnsubscribe(hdr(withHeader, "List-Unsubscribe"), hdr(withHeader, "List-Unsubscribe-Post"));

      let method = "";
      let verified = false;
      let evidence = "";
      let attemptNote = "";

      if (info.oneClick && info.url && isSafePublicHttpsUrl(info.url)) {
        try {
          const res = await fetch(info.url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
            redirect: "manual",
            signal: AbortSignal.timeout(15_000),
          });
          if (res.status >= 200 && res.status < 400) {
            method = "one-click";
            verified = true;
            evidence = `RFC 8058 one-click POST to ${new URL(info.url).host} returned HTTP ${res.status}`;
          } else {
            attemptNote = `One-click POST returned HTTP ${res.status}. `;
          }
        } catch (err) {
          attemptNote = `One-click POST failed (${err instanceof Error ? err.message : "network error"}). `;
        }
      }

      if (!method && info.mailto) {
        let u: URL | undefined;
        try {
          u = new URL(info.mailto);
        } catch {
          u = undefined;
        }
        const target = u ? decodeURIComponent(u.pathname) : "";
        const to = extractEmails(target);
        if (u && to.length) {
          const subject = u.searchParams.get("subject") || "unsubscribe";
          const body = u.searchParams.get("body") || "Please unsubscribe me from this mailing list.";
          const sent = await sendRaw(gmail, buildMime({ to, subject, body }));
          if (sent.id) {
            const v = await verifySent(gmail, sent.id);
            if (v.verified) {
              method = "mailto";
              verified = true;
              evidence = `Unsubscribe email sent to ${to.join(", ")}. ${v.evidence}`;
            }
          }
        }
      }

      if (!method) {
        const manual = info.url ?? info.mailto;
        return fail(`Could not unsubscribe from ${email} automatically. ${attemptNote}`.trim(), "upstream_error", manual ? `Ask the user to open this link to finish unsubscribing: ${manual}` : "Offer to archive their mail instead.", { sender: email, url: info.url, mailto: info.mailto });
      }

      let archived = 0;
      let archiveEvidence = "";
      if (input.archiveExisting) {
        const inbox = await listMessageIds(gmail, { q: `from:${email} in:inbox`, max: 500 });
        if (inbox.ids.length) {
          const r = await applyLabels(gmail, inbox.ids, [], ["INBOX"]);
          archived = inbox.ids.length;
          archiveEvidence = ` Archived ${archived} inbox email${archived === 1 ? "" : "s"} (${r.sampleOk ? "sample confirmed" : "sample NOT confirmed"}).`;
          if (!r.sampleOk) verified = false;
        }
      }
      return ok(`Unsubscribed from ${email} via ${method}${archived ? `, archived ${archived} existing` : ""}`, {
        data: { sender: email, method, archived },
        verified,
        evidence: `${evidence}.${archiveEvidence}`,
        card: { type: "bulk", action: `unsubscribed (${method})`, count: 1 + archived, items: [email, ...(archived ? [`${archived} inbox emails archived`] : [])] },
      });
    }),
});

/* ------------------------- attachments -> Drive ---------------------------- */

const gmailSaveAttachments = defineTool({
  name: "gmail_save_attachments_to_drive",
  description:
    "Save attachments from emails matching a Gmail query into a Drive folder (created if missing, duplicates skipped). Use for 'put all invoices in Drive'. The query is automatically restricted to messages with attachments.",
  risk: "write",
  connector: "gmail",
  inputSchema: z.object({
    query: z.string().min(1).describe("Gmail query selecting emails, e.g. 'subject:invoice newer_than:30d'."),
    folderName: z.string().default("Jarvis Attachments").describe("Drive folder name (created in My Drive if missing)."),
    max: z.number().int().min(1).max(50).default(20).describe("Max emails to process."),
  }),
  title: (i) => `Saving attachments for “${short(i.query, 40)}” to Drive`,
  execute: (input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const drive = await driveClient(ctx);
      const { ids } = await listMessageIds(gmail, { q: `${input.query} has:attachment`, max: input.max });
      if (!ids.length) return ok("No emails with attachments matched", { data: { saved: 0 }, verified: true, evidence: "Search returned 0 messages", card: { type: "file_list", files: [] } });

      let folder;
      try {
        folder = await findOrCreateFolder(drive, input.folderName);
      } catch (err) {
        throw new ToolFailure(mapError(err, "drive"));
      }

      const existing: { name: string; msg?: string; orig?: string }[] = [];
      let pageToken: string | undefined;
      do {
        const r = await drive.files.list({
          q: `'${folder.id}' in parents and trashed = false`,
          fields: "nextPageToken, files(name, appProperties)",
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });
        for (const f of r.data.files ?? []) existing.push({ name: f.name ?? "", msg: f.appProperties?.jarvisMsg, orig: f.appProperties?.jarvisName });
        pageToken = r.data.nextPageToken ?? undefined;
      } while (pageToken);

      const messages = await mapLimit(ids, 5, async (id) => (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data);
      const uploaded: { id: string; name: string; url: string; modified?: string }[] = [];
      let skipped = 0;
      let failed = 0;
      for (const m of messages) {
        const msgId = m.id ?? "";
        const { attachments } = parseBody(m.payload ?? undefined);
        const date = m.internalDate ? toLocalISO(new Date(Number(m.internalDate)), ctx.timezone).slice(0, 10) : "undated";
        for (const a of attachments) {
          if (a.mimeType.startsWith("image/") && a.size < 8_000) continue; // signature logos / tracking pixels
          if (a.size > 25 * 1024 * 1024) {
            skipped++;
            continue;
          }
          const dup = existing.some((f) => (f.orig ?? f.name) === a.filename && (f.msg === undefined || f.msg === msgId));
          if (dup) {
            skipped++;
            continue;
          }
          let name = a.filename;
          if (existing.some((f) => f.name === name)) name = `${date}_${a.filename}`;
          if (existing.some((f) => f.name === name)) name = `${date}_${msgId.slice(0, 6)}_${a.filename}`;
          try {
            const att = await gmail.users.messages.attachments.get({ userId: "me", messageId: msgId, id: a.attachmentId });
            if (!att.data.data) throw new Error("empty attachment");
            const buf = b64urlDecode(att.data.data);
            const up = await drive.files.create({
              requestBody: { name, parents: [folder.id], appProperties: { jarvisMsg: msgId, jarvisName: a.filename } },
              media: { mimeType: a.mimeType || "application/octet-stream", body: Readable.from(buf) },
              fields: "id,name,webViewLink,modifiedTime",
              supportsAllDrives: true,
            });
            if (up.data.id) {
              uploaded.push({ id: up.data.id, name: up.data.name ?? name, url: up.data.webViewLink ?? `https://drive.google.com/file/d/${up.data.id}/view`, modified: up.data.modifiedTime ?? undefined });
              existing.push({ name, msg: msgId, orig: a.filename });
            } else failed++;
          } catch (err) {
            if ((err as { response?: { status?: number } })?.response?.status === 403 || (err as { response?: { status?: number } })?.response?.status === 401) throw err;
            failed++;
          }
        }
      }

      const checks = await mapLimit(uploaded, 5, async (f) => {
        try {
          const r = await drive.files.get({ fileId: f.id, fields: "id,name,parents,trashed", supportsAllDrives: true });
          return Boolean(r.data.id) && !r.data.trashed && (r.data.parents ?? []).includes(folder.id);
        } catch {
          return false;
        }
      });
      const confirmed = checks.filter(Boolean).length;
      const allOk = confirmed === uploaded.length && failed === 0;
      return {
        ok: failed === 0,
        summary: `Saved ${uploaded.length} attachment${uploaded.length === 1 ? "" : "s"} to Drive folder “${folder.name}”${skipped ? `, skipped ${skipped} duplicate/oversized` : ""}${failed ? `, ${failed} failed` : ""}`,
        data: { folder: { id: folder.id, name: folder.name, url: `https://drive.google.com/drive/folders/${folder.id}` }, saved: uploaded.map((f) => ({ id: f.id, name: f.name, url: f.url })), skipped, failed, messagesScanned: messages.length },
        verified: uploaded.length === 0 ? failed === 0 : allOk,
        evidence: uploaded.length ? `Drive confirms ${confirmed}/${uploaded.length} uploaded files exist in folder ${folder.id}` : "No new files needed uploading",
        error: failed ? "upstream_error" : undefined,
        suggestion: failed ? "Some attachments failed to upload; run again to retry only the missing ones." : undefined,
        card: { type: "file_list", files: uploaded.map((f) => ({ id: f.id, title: f.name, url: f.url, kind: driveKind(""), modified: f.modified })) },
      } satisfies ToolResult;
    }),
});

const gmailListLabels = defineTool({
  name: "gmail_list_labels",
  description: "List the user's Gmail labels (name, id, type). Use before gmail_bulk_action with add_label/remove_label or to check if a label exists.",
  risk: "read",
  connector: "gmail",
  inputSchema: z.object({}),
  title: () => "Listing Gmail labels",
  execute: (_input, ctx) =>
    guard("gmail", async () => {
      const gmail = await gmailClient(ctx);
      const r = await gmail.users.labels.list({ userId: "me" });
      const labels = (r.data.labels ?? []).map((l) => ({ id: l.id ?? "", name: l.name ?? "", type: l.type ?? "" }));
      return ok(`${labels.length} Gmail labels`, { data: { labels } });
    }),
});

export const gmailTools: JarvisTool[] = [
  gmailSearch,
  gmailRead,
  gmailReadThread,
  gmailSend,
  gmailReply,
  gmailCreateDraft,
  gmailDraftReply,
  gmailBulkAction,
  gmailFindUnreplied,
  gmailListSubscriptions,
  gmailUnsubscribe,
  gmailSaveAttachments,
  gmailListLabels,
];
