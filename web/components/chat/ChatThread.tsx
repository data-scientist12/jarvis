"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import { AnimatePresence, motion } from "motion/react";
import { Orb } from "@/components/orb/Orb";
import { mutate } from "@/hooks/useApi";
import { useChatStore } from "@/hooks/useChatStore";
import { useOrbState } from "@/hooks/useOrbState";
import { Composer } from "./Composer";
import { ErrorBanner } from "./ErrorBanner";
import { AssistantMessage, ThinkingRow, UserMessage } from "./Messages";
import { SuggestionChips, type Suggestion } from "./Suggestions";
import type { JarvisMessage } from "./types";

/**
 * The conversation view. AI SDK v7 `useChat` with:
 *  - `id` = conversation id (client generated), `messages` = persisted history
 *  - DefaultChatTransport -> POST /api/chat with `{ id, messages, timezone }`
 *  - `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` (resume after Approve/Deny)
 *  - `addToolApprovalResponse({ id: approval.id, approved })` for approval-requested tool parts
 */
/** Conversation ids whose first prompt was already sent (survives remounts). */
const sentPrompts = new Set<string>();

export function ChatThread({ id, initialMessages, initialPrompt }: { id: string; initialMessages: JarvisMessage[]; initialPrompt: string | null }) {
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<{ kind: "success" | "error"; key: number } | null>(null);
  const clearPending = useChatStore((s) => s.clear);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const sentInitial = useRef(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<JarvisMessage>({
        api: "/api/chat",
        body: () => ({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      }),
    [],
  );

  const { messages, sendMessage, status, stop, error, regenerate, clearError, addToolApprovalResponse } = useChat<JarvisMessage>({
    id,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ message, isError }) => {
      mutate("/api/conversations");
      const review = message.parts.findLast((p) => p.type === "data-review");
      const failed = isError || (review?.type === "data-review" && review.data.status === "failed");
      const ok = review?.type === "data-review" && review.data.status === "succeeded";
      if (failed) setFlash({ kind: "error", key: Date.now() });
      else if (ok) setFlash({ kind: "success", key: Date.now() });
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const last = messages[messages.length - 1];

  function submit(text: string) {
    pinned.current = true;
    void sendMessage({ text });
    setInput("");
    setTimeout(() => mutate("/api/conversations"), 1500);
  }

  // First prompt handed over from the dashboard / suggestion chips.
  // Deferred one tick so React Strict Mode's throwaway first mount never sends (its request would be aborted).
  useEffect(() => {
    if (!initialPrompt || sentInitial.current || sentPrompts.has(id)) return;
    const t = setTimeout(() => {
      if (sentPrompts.has(id)) return;
      sentInitial.current = true;
      sentPrompts.add(id);
      clearPending(id);
      void sendMessage({ text: initialPrompt });
      setTimeout(() => mutate("/api/conversations"), 1500);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stick to the bottom while the user hasn't scrolled away.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: busy ? "auto" : "smooth" });
  }, [messages, status, busy]);

  const lastAssistantTools = last?.role === "assistant" ? last.parts.filter(isToolUIPart) : [];
  const acting = busy && lastAssistantTools.some((p) => p.state === "input-streaming" || p.state === "input-available" || p.state === "approval-responded");
  const orbState = useOrbState({ busy, acting, flash });

  const waitingForFirstToken = status === "submitted" || (status === "streaming" && last?.role === "assistant" && last.parts.length === 0);
  const empty = messages.length === 0;

  function pickSuggestion(s: Suggestion) {
    if (s.fill) {
      setInput(s.prompt);
      requestAnimationFrame(() => {
        const el = composerRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(s.prompt.length, s.prompt.length);
        }
      });
    } else submit(s.prompt);
  }

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
        }}
        className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {empty ? (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-5 py-10 text-center">
            <Orb size={88} state={orbState} />
            <h1 className="mt-8 text-[28px] font-semibold tracking-tight">What can I do for you?</h1>
            <p className="mt-1.5 max-w-md text-[15px] text-ink-2">Ask in plain English. Jarvis will do it in Gmail, Calendar, Drive or Tasks and show you the proof.</p>
            <SuggestionChips onPick={pickSuggestion} className="mt-8" />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-7 px-4 pb-8 pt-8 sm:px-6">
            {messages.map((m) =>
              m.role === "user" ? (
                <UserMessage key={m.id} message={m} />
              ) : m.role === "assistant" ? (
                <motion.div key={m.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <AssistantMessage
                    message={m}
                    live={busy && m.id === last?.id}
                    onApprove={(approvalId) => void addToolApprovalResponse({ id: approvalId, approved: true })}
                    onDeny={(approvalId) => void addToolApprovalResponse({ id: approvalId, approved: false })}
                  />
                </motion.div>
              ) : null,
            )}
            {waitingForFirstToken && <ThinkingRow />}
          </div>
        )}
      </div>

      <div className="pb-safe shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5">
        <div className="mx-auto max-w-3xl">
          <AnimatePresence>
            {error && (
              <ErrorBanner
                error={error}
                onDismiss={clearError}
                onRetry={() => {
                  clearError();
                  void regenerate();
                }}
              />
            )}
          </AnimatePresence>
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={submit}
            busy={busy}
            onStop={() => void stop()}
            orbState={orbState}
            orbPulseKey={lastAssistantTools.length}
            textareaRef={composerRef}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}
