import { z } from "zod";
import type { drive_v3 } from "googleapis";
import { defineTool, fail, ok, type JarvisTool, type ToolResult } from "@/lib/tools/types";
import { InputError, cleanEmails, driveClient, escapeDriveQ, guard, short, truncate } from "./util";

type Drive = drive_v3.Drive;

export const FOLDER_MIME = "application/vnd.google-apps.folder";
const G = "application/vnd.google-apps.";

export function driveKind(mime: string): "doc" | "sheet" | "slides" | "folder" | "file" {
  if (mime === `${G}document`) return "doc";
  if (mime === `${G}spreadsheet`) return "sheet";
  if (mime === `${G}presentation`) return "slides";
  if (mime === FOLDER_MIME) return "folder";
  return "file";
}

export async function findOrCreateFolder(drive: Drive, name: string, parentId?: string): Promise<{ id: string; name: string; created: boolean }> {
  const parent = parentId ?? "root";
  const found = await drive.files.list({
    q: `mimeType = '${FOLDER_MIME}' and name = '${escapeDriveQ(name)}' and '${escapeDriveQ(parent)}' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: 1,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const hit = found.data.files?.[0];
  if (hit?.id) return { id: hit.id, name: hit.name ?? name, created: false };
  const c = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
    fields: "id,name",
    supportsAllDrives: true,
  });
  if (!c.data.id) throw new Error("Drive did not return the folder id");
  return { id: c.data.id, name: c.data.name ?? name, created: true };
}

/** Downloads a Drive file's bytes. Google-native files are exported (Docs/Slides -> PDF, Sheets -> XLSX). */
export async function downloadDriveFile(drive: Drive, fileId: string, maxBytes: number): Promise<{ filename: string; mimeType: string; data: Buffer }> {
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType,size", supportsAllDrives: true });
  const name = meta.data.name ?? fileId;
  const mime = meta.data.mimeType ?? "application/octet-stream";
  if (mime === FOLDER_MIME) throw new InputError(`“${name}” is a folder and cannot be attached.`);
  let data: Buffer;
  let outName = name;
  let outMime = mime;
  if (mime.startsWith(G)) {
    if (mime === `${G}spreadsheet`) {
      outMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      outName = `${name}.xlsx`;
    } else {
      outMime = "application/pdf";
      outName = `${name}.pdf`;
    }
    const r = await drive.files.export({ fileId, mimeType: outMime }, { responseType: "arraybuffer" });
    data = Buffer.from(r.data as ArrayBuffer);
  } else {
    const size = Number(meta.data.size ?? 0);
    if (size > maxBytes) throw new InputError(`“${name}” is ${(size / 1048576).toFixed(1)}MB, over the attachment size limit.`);
    const r = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    data = Buffer.from(r.data as ArrayBuffer);
  }
  if (data.length > maxBytes) throw new InputError(`“${outName}” is ${(data.length / 1048576).toFixed(1)}MB, over the attachment size limit.`);
  return { filename: outName, mimeType: outMime, data };
}

const TYPE_MIME: Record<string, string> = {
  doc: `${G}document`,
  sheet: `${G}spreadsheet`,
  slides: `${G}presentation`,
  pdf: "application/pdf",
  folder: FOLDER_MIME,
};

const FILE_FIELDS = "id,name,mimeType,webViewLink,modifiedTime,thumbnailLink,owners(displayName,emailAddress)";

const driveSearch = defineTool({
  name: "drive_search",
  description: "Search Google Drive for files by name or content. Use to find documents, sheets, slides, PDFs or folders the user mentions. Returns id, name, type, link, modified date.",
  risk: "read",
  connector: "drive",
  inputSchema: z.object({
    query: z.string().describe("Free-text search (matches file names and contents). May be empty when filtering by type only."),
    type: z.enum(["doc", "sheet", "slides", "pdf", "folder", "any"]).default("any").describe("Restrict to a file type."),
    max: z.number().int().min(1).max(50).default(15).describe("Max results."),
  }),
  title: (i) => `Searching Drive for “${short(i.query || i.type, 40)}”`,
  execute: (input, ctx) =>
    guard("drive", async () => {
      const drive = await driveClient(ctx);
      const parts = ["trashed = false"];
      const q = input.query.trim();
      if (q) parts.push(`(name contains '${escapeDriveQ(q)}' or fullText contains '${escapeDriveQ(q)}')`);
      if (input.type !== "any") parts.push(`mimeType = '${TYPE_MIME[input.type]}'`);
      const r = await drive.files.list({
        q: parts.join(" and "),
        orderBy: "modifiedTime desc",
        pageSize: input.max,
        fields: `files(${FILE_FIELDS})`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const files = (r.data.files ?? []).map((f) => ({
        id: f.id ?? "",
        name: f.name ?? "",
        mimeType: f.mimeType ?? "",
        kind: driveKind(f.mimeType ?? ""),
        url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
        modified: f.modifiedTime ?? undefined,
        thumbnail: f.thumbnailLink ?? undefined,
        owner: f.owners?.[0]?.emailAddress ?? undefined,
      }));
      return ok(files.length ? `Found ${files.length} file${files.length === 1 ? "" : "s"} for “${short(q || input.type, 40)}”` : `No Drive files match “${short(q || input.type, 40)}”`, {
        data: { count: files.length, files: files.map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, kind: f.kind, url: f.url, modified: f.modified, owner: f.owner })) },
        card: { type: "file_list", files: files.map((f) => ({ id: f.id, title: f.name, url: f.url, kind: f.kind, modified: f.modified })) },
      });
    }),
});

const TEXT_MIMES = new Set(["application/json", "application/xml", "text/csv", "text/plain", "text/markdown", "text/html", "text/xml", "application/x-yaml"]);

const driveReadFile = defineTool({
  name: "drive_read_file",
  description: "Read the text content of a Drive file: Google Docs, Sheets (as CSV), Slides, and plain text/markdown/csv/json files. Use after drive_search to summarize or extract info. PDFs and Office files are not extractable.",
  risk: "read",
  connector: "drive",
  inputSchema: z.object({ fileId: z.string().describe("Drive file id from drive_search.") }),
  title: () => "Reading a Drive file",
  execute: (input, ctx) =>
    guard("drive", async () => {
      const drive = await driveClient(ctx);
      const meta = await drive.files.get({ fileId: input.fileId, fields: "id,name,mimeType,size,webViewLink,modifiedTime", supportsAllDrives: true });
      const name = meta.data.name ?? input.fileId;
      const mime = meta.data.mimeType ?? "";
      const base = { id: input.fileId, name, mimeType: mime, link: meta.data.webViewLink ?? undefined, modified: meta.data.modifiedTime ?? undefined };
      let text: string | undefined;
      if (mime === `${G}document` || mime === `${G}presentation`) {
        const r = await drive.files.export({ fileId: input.fileId, mimeType: "text/plain" }, { responseType: "text" });
        text = String(r.data);
      } else if (mime === `${G}spreadsheet`) {
        const r = await drive.files.export({ fileId: input.fileId, mimeType: "text/csv" }, { responseType: "text" });
        text = String(r.data);
      } else if (TEXT_MIMES.has(mime) || mime.startsWith("text/")) {
        if (Number(meta.data.size ?? 0) > 5 * 1024 * 1024) return fail(`“${name}” is too large to read (over 5MB).`, "invalid_input", "Ask the user for a specific section or use a smaller file.");
        const r = await drive.files.get({ fileId: input.fileId, alt: "media", supportsAllDrives: true }, { responseType: "text" });
        text = String(r.data);
      }
      if (text === undefined) {
        return ok(`“${name}” (${mime || "unknown type"}) cannot be read as text; returning metadata only`, {
          data: { ...base, content: null, note: "Content extraction is not supported for this file type (PDF/Office/image). Share the link with the user instead." },
        });
      }
      const content = truncate(text.replace(/\r\n/g, "\n"), 15000);
      return ok(`Read “${name}” (${text.length.toLocaleString()} characters)`, { data: { ...base, content, truncated: text.length > 15000 } });
    }),
});

const driveCreateFolder = defineTool({
  name: "drive_create_folder",
  description: "Create a folder in Google Drive (optionally inside another folder). Use to organise files before saving or moving things.",
  risk: "write",
  connector: "drive",
  inputSchema: z.object({
    name: z.string().min(1).describe("Folder name."),
    parentId: z.string().optional().describe("Parent folder id; omit for My Drive root."),
  }),
  title: (i) => `Creating Drive folder “${short(i.name, 40)}”`,
  execute: (input, ctx) =>
    guard("drive", async () => {
      const drive = await driveClient(ctx);
      const c = await drive.files.create({
        requestBody: { name: input.name, mimeType: FOLDER_MIME, parents: input.parentId ? [input.parentId] : undefined },
        fields: "id,name,webViewLink",
        supportsAllDrives: true,
      });
      const id = c.data.id;
      if (!id) return fail("Drive did not return a folder id.", "upstream_error", "Retry once.");
      const v = await drive.files.get({ fileId: id, fields: "id,name,mimeType,parents,webViewLink,trashed", supportsAllDrives: true });
      const verified = v.data.mimeType === FOLDER_MIME && v.data.name === input.name && !v.data.trashed && (!input.parentId || (v.data.parents ?? []).includes(input.parentId));
      const url = v.data.webViewLink ?? `https://drive.google.com/drive/folders/${id}`;
      return {
        ok: verified,
        summary: `Folder “${input.name}” created in Drive`,
        data: { id, name: input.name, url },
        verified,
        evidence: verified ? `Drive folder ${id} re-read: name and type match` : `Drive folder ${id} did not match when re-read`,
        card: { type: "doc", title: input.name, url, kind: "folder" },
      } satisfies ToolResult;
    }),
});

const driveShare = defineTool({
  name: "drive_share",
  description: "Share a Drive file or folder with a person by email (viewer, commenter or editor). Use when the user asks to share/give access. Resolve names via contacts_search first.",
  risk: "high",
  connector: "drive",
  inputSchema: z.object({
    fileId: z.string().describe("Drive file/folder id."),
    email: z.string().describe("Email address of the person to share with."),
    role: z.enum(["reader", "commenter", "writer"]).default("reader").describe("Access level."),
    notify: z.boolean().default(true).describe("Send the person an email notification."),
  }),
  title: (i) => `Sharing a file with ${short(i.email, 40)}`,
  execute: (input, ctx) =>
    guard("drive", async () => {
      const [email] = cleanEmails([input.email], "email");
      if (!email) throw new InputError("A valid email is required.");
      const drive = await driveClient(ctx);
      const meta = await drive.files.get({ fileId: input.fileId, fields: "id,name,mimeType,webViewLink", supportsAllDrives: true });
      await drive.permissions.create({
        fileId: input.fileId,
        sendNotificationEmail: input.notify,
        supportsAllDrives: true,
        requestBody: { type: "user", role: input.role, emailAddress: email },
      });
      const list = await drive.permissions.list({ fileId: input.fileId, fields: "permissions(id,emailAddress,role,type)", supportsAllDrives: true });
      const perm = (list.data.permissions ?? []).find((p) => p.emailAddress?.toLowerCase() === email);
      const verified = Boolean(perm) && perm?.role === input.role;
      const name = meta.data.name ?? input.fileId;
      return {
        ok: verified || Boolean(perm),
        summary: `Shared “${name}” with ${email} as ${input.role}`,
        data: { fileId: input.fileId, email, role: perm?.role ?? input.role, url: meta.data.webViewLink },
        verified,
        evidence: perm ? `Drive permissions list shows ${email} as ${perm.role}` : `${email} not found in the permission list after sharing`,
        error: perm ? undefined : "upstream_error",
        card: { type: "doc", title: name, url: meta.data.webViewLink ?? `https://drive.google.com/file/d/${input.fileId}/view`, kind: driveKind(meta.data.mimeType ?? "") },
      } satisfies ToolResult;
    }),
});

export const driveTools: JarvisTool[] = [driveSearch, driveReadFile, driveCreateFolder, driveShare];
