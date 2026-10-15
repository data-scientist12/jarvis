"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/components/utils/cn";

type ToastItem = {
  id: number;
  title: string;
  description?: string;
  tone: "default" | "success" | "error";
  action?: { label: string; href: string };
};

const useToastStore = create<{ items: ToastItem[]; push: (t: Omit<ToastItem, "id" | "tone"> & { tone?: ToastItem["tone"] }) => void; dismiss: (id: number) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items.slice(-2), { tone: "default", ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

export const toast = {
  show: (title: string, opts: { description?: string; action?: ToastItem["action"] } = {}) => useToastStore.getState().push({ title, ...opts }),
  success: (title: string, opts: { description?: string; action?: ToastItem["action"] } = {}) => useToastStore.getState().push({ title, tone: "success", ...opts }),
  error: (title: string, opts: { description?: string; action?: ToastItem["action"] } = {}) => useToastStore.getState().push({ title, tone: "error", ...opts }),
};

export function Toaster() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="glass pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl px-4 py-3 shadow-float ring-1 ring-hairline"
            onClick={() => dismiss(t.id)}
          >
            {t.tone === "success" && <CircleCheck className="size-5 shrink-0 text-ok" strokeWidth={1.75} />}
            {t.tone === "error" && <CircleAlert className="size-5 shrink-0 text-bad" strokeWidth={1.75} />}
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink">{t.title}</p>
              {t.description && <p className={cn("mt-0.5 text-[13px] text-ink-2")}>{t.description}</p>}
            </div>
            {t.action && (
              <Link href={t.action.href} className="shrink-0 text-[14px] font-medium text-accent" onClick={(e) => e.stopPropagation()}>
                {t.action.label}
              </Link>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
