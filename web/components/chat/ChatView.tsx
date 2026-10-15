"use client";

import { useState } from "react";
import { Orb } from "@/components/orb/Orb";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { ApiError } from "@/components/utils/api";
import { useApi } from "@/hooks/useApi";
import { useChatStore } from "@/hooks/useChatStore";
import { ChatThread } from "./ChatThread";
import type { JarvisMessage } from "./types";

type Conversation = { id: string; title: string; messages: JarvisMessage[] };

/** Loads the persisted thread (unless it was just created client-side) and mounts <ChatThread/>. Render with `key={id}`. */
export function ChatView({ id }: { id: string }) {
  // Captured once: a brand-new chat skips the fetch; its first prompt (if any) is sent on mount.
  const [handoff] = useState(() => {
    const pending = useChatStore.getState().pending;
    return { fresh: id in pending, prompt: pending[id] ?? null };
  });

  const { data, error, refresh } = useApi<Conversation>(handoff.fresh ? null : `/api/conversations/${id}`);

  if (handoff.fresh) return <ChatThread id={id} initialMessages={[]} initialPrompt={handoff.prompt} />;

  if (data) return <ChatThread id={id} initialMessages={data.messages ?? []} initialPrompt={null} />;

  if (error instanceof ApiError && error.status === 404) return <ChatThread id={id} initialMessages={[]} initialPrompt={null} />;

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <Orb size={64} state="error" />
        <div>
          <p className="text-[17px] font-semibold">Couldn&apos;t load this chat</p>
          <p className="mt-1 text-[14px] text-ink-2">{error.message}</p>
        </div>
        <Button variant="secondary" onClick={refresh}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 pt-10">
      <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-16 w-4/5 rounded-2xl" />
    </div>
  );
}
