/* eslint-disable @next/next/no-img-element */
"use client";

import { ExternalLink, File, FileText, Folder, FolderOpen, Presentation, Sheet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { relativeTime } from "@/components/utils/format";
import type { Card } from "@/lib/tools/types";
import { CardLabel, CardShell, MoreRow } from "./CardShell";

type DocData = Extract<Card, { type: "doc" }>;
type FileListData = Extract<Card, { type: "file_list" }>;

export const KIND: Record<string, { icon: LucideIcon; color: string; label: string }> = {
  doc: { icon: FileText, color: "#4285f4", label: "Google Doc" },
  sheet: { icon: Sheet, color: "#1e9e50", label: "Google Sheet" },
  slides: { icon: Presentation, color: "#f4b400", label: "Google Slides" },
  folder: { icon: Folder, color: "#8e8e93", label: "Folder" },
  file: { icon: File, color: "#6e6e73", label: "File" },
};

export function kindMeta(kind: string) {
  return KIND[kind] ?? KIND.file;
}

export function FileIcon({ kind, size = 40 }: { kind: string; size?: number }) {
  const k = kindMeta(kind);
  const Icon = k.icon;
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, color: k.color, background: `color-mix(in srgb, ${k.color} 14%, transparent)` }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.5} />
    </span>
  );
}

export function DocCard({ card }: { card: DocData }) {
  const k = kindMeta(card.kind);
  return (
    <CardShell>
      {card.thumbnail && <img src={card.thumbnail} alt="" referrerPolicy="no-referrer" className="h-32 w-full border-b border-hairline object-cover object-top" />}
      <div className="flex items-center gap-3.5 p-4">
        <FileIcon kind={card.kind} size={44} />
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[15.5px] font-semibold">{card.title}</h4>
          <p className="text-[13px] text-ink-3">{k.label}</p>
        </div>
        <Button size="sm" href={card.url} external icon={card.kind === "folder" ? <FolderOpen className="size-4" strokeWidth={1.75} /> : <ExternalLink className="size-3.5" strokeWidth={1.75} />}>
          Open
        </Button>
      </div>
    </CardShell>
  );
}

export function FileListCard({ card }: { card: FileListData }) {
  const files = card.files.slice(0, 8);
  return (
    <CardShell>
      <CardLabel icon={<Folder />} right={<span className="text-[12px] text-ink-3">{card.files.length} file{card.files.length === 1 ? "" : "s"}</span>}>
        Drive
      </CardLabel>
      {files.length === 0 ? (
        <p className="px-4 py-5 text-[14px] text-ink-2">No files found.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {files.map((f) => (
            <li key={f.id}>
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-fill">
                <FileIcon kind={f.kind} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium">{f.title}</span>
                  {f.modified && <span className="block text-[12.5px] text-ink-3">Edited {relativeTime(f.modified)}</span>}
                </span>
                <ExternalLink className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
              </a>
            </li>
          ))}
        </ul>
      )}
      <MoreRow count={card.files.length - files.length} noun="more files" />
    </CardShell>
  );
}
