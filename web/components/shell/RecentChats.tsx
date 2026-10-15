"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { api } from "@/components/utils/api";
import { cn } from "@/components/utils/cn";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toaster";
import { mutate, useApi } from "@/hooks/useApi";
import type { ConversationSummary } from "./nav";

export function RecentChats({ onNavigate, limit = 12 }: { onNavigate?: () => void; limit?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data, loading } = useApi<{ conversations: ConversationSummary[] }>("/api/conversations");
  const [toDelete, setToDelete] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/api/conversations/${toDelete.id}`, { method: "DELETE" });
      mutate("/api/conversations");
      if (pathname === `/chat/${toDelete.id}`) router.push("/dashboard");
      setToDelete(null);
    } catch (e) {
      toast.error("Couldn't delete the chat", { description: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  const items = (data?.conversations ?? []).slice(0, limit);

  return (
    <div>
      <p className="px-3 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Recent</p>
      {loading ? (
        <div className="space-y-1.5 px-3 pt-1">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-3 py-1 text-[13px] text-ink-3">No chats yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((c) => {
            const active = pathname === `/chat/${c.id}`;
            return (
              <li key={c.id} className="group relative">
                <Link
                  href={`/chat/${c.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 pr-8 text-[14px] transition-colors",
                    active ? "bg-fill-strong font-medium text-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0 opacity-70" strokeWidth={1.5} />
                  <span className="truncate">{c.title || "New chat"}</span>
                </Link>
                <button
                  aria-label={`Delete ${c.title}`}
                  onClick={() => setToDelete(c)}
                  className="absolute right-1.5 top-1/2 hidden size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-fill-strong hover:text-ink group-hover:flex"
                >
                  <X className="size-3.5" strokeWidth={1.75} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog
        open={!!toDelete}
        title="Delete this chat?"
        description={toDelete ? `“${toDelete.title}” will be removed. Actions Jarvis already took stay in Activity.` : undefined}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
