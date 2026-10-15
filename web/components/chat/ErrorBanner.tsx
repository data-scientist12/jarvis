"use client";

import { APICallError } from "ai";
import { motion } from "motion/react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function describeChatError(error: Error): { message: string; kind: "rate" | "auth" | "other" } {
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  const text = error.message ?? "";
  if (status === 429 || /rate_limited/.test(text)) return { message: "Jarvis needs a breather — try again in a minute.", kind: "rate" };
  if (status === 401 || /unauthorized/.test(text)) return { message: "Your session expired. Sign in again to continue.", kind: "auth" };
  if (status === 403) return { message: "You don't have access to do that.", kind: "other" };
  return { message: "Something went wrong on our side. Please try again.", kind: "other" };
}

export function ErrorBanner({ error, onRetry, onDismiss }: { error: Error; onRetry: () => void; onDismiss: () => void }) {
  const info = describeChatError(error);
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mb-3 flex items-center gap-3 rounded-2xl bg-bad/10 px-4 py-3 ring-1 ring-bad/20"
    >
      <TriangleAlert className="size-5 shrink-0 text-bad" strokeWidth={1.75} />
      <p className="min-w-0 flex-1 text-[14px] text-ink">{info.message}</p>
      {info.kind === "auth" ? (
        <Button size="sm" href="/login">
          Sign in
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      )}
      <button onClick={onDismiss} className="text-[13px] text-ink-3 hover:text-ink-2" aria-label="Dismiss">
        Dismiss
      </button>
    </motion.div>
  );
}
