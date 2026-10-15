"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import { signOut } from "@/lib/auth/client";
import { Avatar } from "@/components/ui/Avatar";

export type ShellUser = { name: string; email: string; image: string | null };

export function useSignOut() {
  const router = useRouter();
  return async () => {
    try {
      await signOut();
    } finally {
      router.push("/");
      router.refresh();
    }
  };
}

/** Avatar row at the bottom of the sidebar with a small popover menu. */
export function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const doSignOut = useSignOut();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-2xl bg-surface p-1.5 shadow-float ring-1 ring-hairline"
          >
            <div className="px-3 py-2">
              <p className="truncate text-[14px] font-medium">{user.name}</p>
              <p className="truncate text-[12px] text-ink-2">{user.email}</p>
            </div>
            <div className="my-1 h-px bg-hairline" />
            <Link href="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] hover:bg-fill">
              <Settings className="size-4 text-ink-2" strokeWidth={1.5} /> Settings
            </Link>
            <button onClick={doSignOut} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[14px] text-bad hover:bg-bad/10">
              <LogOut className="size-4" strokeWidth={1.5} /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-fill"
      >
        <Avatar name={user.name || user.email} src={user.image} size={32} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium leading-tight">{user.name || "Account"}</span>
          <span className="block truncate text-[12px] leading-tight text-ink-2">{user.email}</span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-ink-3" strokeWidth={1.5} />
      </button>
    </div>
  );
}
