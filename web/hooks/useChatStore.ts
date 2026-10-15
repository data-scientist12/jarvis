"use client";

import { create } from "zustand";

/**
 * Hand-off between the dashboard / "New chat" button and /chat/[id]:
 * a key present in `pending` means "this conversation is brand new, don't fetch it";
 * a string value is the first prompt to send as soon as the thread mounts.
 */
type ChatStore = {
  pending: Record<string, string | null>;
  start: (id: string, prompt?: string | null) => void;
  clear: (id: string) => void;
};

export const useChatStore = create<ChatStore>((set) => ({
  pending: {},
  start: (id, prompt = null) => set((s) => ({ pending: { ...s.pending, [id]: prompt } })),
  clear: (id) =>
    set((s) => {
      if (!(id in s.pending)) return s;
      const next = { ...s.pending };
      delete next[id];
      return { pending: next };
    }),
}));

export function newChatId() {
  return crypto.randomUUID();
}
