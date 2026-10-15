import { z } from "zod";
import type { docs_v1 } from "googleapis";
import { defineTool, fail, type JarvisTool, type ToolResult } from "@/lib/tools/types";
import { docsClient, driveClient, guard, short } from "./util";

const docUrl = (id: string) => `https://docs.google.com/document/d/${id}/edit`;

type Req = docs_v1.Schema$Request;

interface Layout {
  /** Text to insert (no trailing newline: the document's own final newline closes the last paragraph). */
  text: string;
  /** Style requests, valid once `text` is inserted starting at `startIndex`. */
  styleRequests: Req[];
}

type ParaKind = "normal" | "h1" | "h2" | "h3" | "bullet" | "number" | "blank";

/** Converts markdown-ish content into plain text + Docs style requests. */
export function layoutContent(content: string, startIndex: number, resetInherited: { bullets: boolean; all: boolean }): Layout {
  const rawLines = content.replace(/\r\n?/g, "\n").split("\n");
  // collapse blank-line runs to one and trim leading/trailing blanks
  const lines: string[] = [];
  for (const l of rawLines) {
    if (l.trim() === "" && (lines.length === 0 || lines[lines.length - 1] === "")) continue;
    lines.push(l.trim() === "" ? "" : l);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();

  let text = "";
  const paras: { start: number; end: number; kind: ParaKind }[] = [];
  const bold: { start: number; end: number }[] = [];

  lines.forEach((line, idx) => {
    let kind: ParaKind = "normal";
    let body = line;
    let m: RegExpMatchArray | null;
    if (line === "") {
      kind = "blank";
      body = "";
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      kind = (`h${Math.min(3, m[1].length)}`) as ParaKind;
      body = m[2];
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      kind = "bullet";
      body = m[1];
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      kind = "number";
      body = m[1];
    }
    // inline **bold**
    let plain = "";
    const paraStart = startIndex + text.length;
    const re = /\*\*(.+?)\*\*/g;
    let last = 0;
    let bm: RegExpExecArray | null;
    while ((bm = re.exec(body))) {
      plain += body.slice(last, bm.index);
      const bs = paraStart + plain.length;
      plain += bm[1];
      bold.push({ start: bs, end: paraStart + plain.length });
      last = bm.index + bm[0].length;
    }
    plain += body.slice(last);
    text += plain;
    paras.push({ start: paraStart, end: paraStart + plain.length, kind });
    if (idx < lines.length - 1) text += "\n";
  });

  const reqs: Req[] = [];
  const total = text.length;
  if (resetInherited.all && total > 0) {
    reqs.push({ updateTextStyle: { range: { startIndex, endIndex: startIndex + total }, textStyle: { bold: false }, fields: "bold" } });
  }
  if (resetInherited.bullets && paras.length) {
    reqs.push({ deleteParagraphBullets: { range: { startIndex, endIndex: startIndex + Math.max(total, 1) } } });
  }
  for (const p of paras) {
    const named = p.kind === "h1" ? "HEADING_1" : p.kind === "h2" ? "HEADING_2" : p.kind === "h3" ? "HEADING_3" : resetInherited.all ? "NORMAL_TEXT" : undefined;
    if (named) {
      reqs.push({
        updateParagraphStyle: { range: { startIndex: p.start, endIndex: p.end + 1 }, paragraphStyle: { namedStyleType: named }, fields: "namedStyleType" },
      });
    }
  }
  for (const b of bold) {
    if (b.end > b.start) reqs.push({ updateTextStyle: { range: { startIndex: b.start, endIndex: b.end }, textStyle: { bold: true }, fields: "bold" } });
  }
  // bullets last (they do not change indices for flat lists)
  let i = 0;
  while (i < paras.length) {
    const k = paras[i].kind;
    if (k === "bullet" || k === "number") {
      let j = i;
      while (j + 1 < paras.length && paras[j + 1].kind === k) j++;
      reqs.push({
        createParagraphBullets: {
          range: { startIndex: paras[i].start, endIndex: paras[j].end + 1 },
          bulletPreset: k === "bullet" ? "BULLET_DISC_CIRCLE_SQUARE" : "NUMBERED_DECIMAL_ALPHA_ROMAN",
        },
      });
      i = j + 1;
    } else i++;
  }
  return { text, styleRequests: reqs };
}

function docPlainText(doc: docs_v1.Schema$Document): string {
  let out = "";
  const walk = (els: docs_v1.Schema$StructuralElement[] | undefined) => {
    for (const el of els ?? []) {
      for (const e of el.paragraph?.elements ?? []) out += e.textRun?.content ?? "";
      for (const row of el.table?.tableRows ?? []) for (const cell of row.tableCells ?? []) walk(cell.content ?? undefined);
    }
  };
  walk(doc.body?.content ?? undefined);
  return out;
}

const docsCreate = defineTool({
  name: "docs_create",
  description:
    "Create a Google Doc with formatted content. Use for notes, meeting summaries, briefs, reports. Content is markdown-ish: '# ', '## ', '### ' headings, '- ' bullets, '1. ' numbered items, **bold**, blank line between paragraphs.",
  risk: "write",
  connector: "drive",
  inputSchema: z.object({
    title: z.string().min(1).describe("Document title."),
    content: z.string().describe("Document body in simple markdown (headings with #, bullets with '- ')."),
    folderId: z.string().optional().describe("Drive folder id to put the doc in (default: My Drive root)."),
  }),
  title: (i) => `Creating doc “${short(i.title, 40)}”`,
  execute: (input, ctx) =>
    guard("drive", async () => {
      const docs = await docsClient(ctx);
      const created = await docs.documents.create({ requestBody: { title: input.title } });
      const id = created.data.documentId;
      if (!id) return fail("Google Docs did not return a document id.", "upstream_error", "Retry once.");
      const layout = layoutContent(input.content, 1, { bullets: false, all: false });
      if (layout.text.length > 0) {
        await docs.documents.batchUpdate({
          documentId: id,
          requestBody: { requests: [{ insertText: { location: { index: 1 }, text: layout.text } }, ...layout.styleRequests] },
        });
      }
      if (input.folderId) {
        const drive = await driveClient(ctx);
        const f = await drive.files.get({ fileId: id, fields: "parents", supportsAllDrives: true });
        await drive.files.update({
          fileId: id,
          addParents: input.folderId,
          removeParents: (f.data.parents ?? []).join(",") || undefined,
          fields: "id,parents",
          supportsAllDrives: true,
        });
      }
      const check = await docs.documents.get({ documentId: id });
      const body = docPlainText(check.data).trim();
      const probe = layout.text.trim().slice(0, 30);
      const titleOk = check.data.title === input.title;
      const verified = titleOk && (layout.text.length === 0 || (body.length > 0 && body.includes(probe)));
      return {
        ok: verified,
        summary: `Doc “${input.title}” created`,
        data: { documentId: id, url: docUrl(id), title: input.title, characters: body.length },
        verified,
        evidence: verified ? `Re-read doc ${id}: title matches and body has ${body.length} characters` : `Doc ${id} re-read mismatch (title ok: ${titleOk}, body length ${body.length})`,
        error: verified ? undefined : "upstream_error",
        card: { type: "doc", title: input.title, url: docUrl(id), kind: "doc" },
      } satisfies ToolResult;
    }),
});

const docsAppend = defineTool({
  name: "docs_append",
  description: "Append content to the end of an existing Google Doc (same markdown-ish format as docs_create). Use to add notes, minutes or action items to a doc the user already has.",
  risk: "write",
  connector: "drive",
  inputSchema: z.object({
    documentId: z.string().describe("Google Doc id."),
    content: z.string().min(1).describe("Text to append (markdown-ish)."),
  }),
  title: () => "Appending to a Google Doc",
  execute: (input, ctx) =>
    guard("drive", async () => {
      const docs = await docsClient(ctx);
      const before = await docs.documents.get({ documentId: input.documentId });
      const content = before.data.body?.content ?? [];
      const lastEl = content[content.length - 1];
      const endIndex = lastEl?.endIndex ?? 2;
      const insertAt = Math.max(1, endIndex - 1);
      const existing = docPlainText(before.data);
      const nonEmpty = existing.replace(/\n/g, "").length > 0;
      const prefix = nonEmpty ? "\n" : "";
      const lastBulleted = Boolean(lastEl?.paragraph?.bullet);
      const layout = layoutContent(input.content, insertAt + prefix.length, { bullets: lastBulleted, all: nonEmpty });
      if (!layout.text) return fail("Nothing to append (content is empty).", "invalid_input", "Provide non-empty content.");
      await docs.documents.batchUpdate({
        documentId: input.documentId,
        requestBody: { requests: [{ insertText: { location: { index: insertAt }, text: prefix + layout.text } }, ...layout.styleRequests] },
      });
      const after = await docs.documents.get({ documentId: input.documentId });
      const afterText = docPlainText(after.data);
      const probe = layout.text.trim().slice(-40);
      const verified = afterText.includes(probe) && afterText.length > existing.length;
      const title = after.data.title ?? "document";
      return {
        ok: verified,
        summary: `Appended ${layout.text.length} characters to “${title}”`,
        data: { documentId: input.documentId, url: docUrl(input.documentId), added: layout.text.length },
        verified,
        evidence: verified ? `Re-read doc: it grew from ${existing.length} to ${afterText.length} characters and contains the new text` : "Appended text was not found when the doc was re-read",
        error: verified ? undefined : "upstream_error",
        card: { type: "doc", title, url: docUrl(input.documentId), kind: "doc" },
      } satisfies ToolResult;
    }),
});

export const docsTools: JarvisTool[] = [docsCreate, docsAppend];
