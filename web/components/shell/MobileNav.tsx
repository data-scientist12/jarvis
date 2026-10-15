"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, Ellipsis, House, LogOut, Plug, Settings, SquarePen, Zap } from "lucide-react";
import { cn } from "@/components/utils/cn";
import { Avatar } from "@/components/ui/Avatar";
import { isActive, useNewChat } from "./Sidebar";
import { RecentChats } from "./RecentChats";
import { useSignOut, type ShellUser } from "./UserMenu";

const TABS = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/automations", label: "Automate", icon: Zap },
  { href: "/activity", label: "Activity", icon: Activity },
];

function TabButton({ active, label, icon: Icon, onClick, href }: { active?: boolean; label: string; icon: typeof House; onClick?: () => void; href?: string }) {
  const cls = cn("flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-medium transition-colors", active ? "text-accent" : "text-ink-2");
  const inner = (
    <>
      <Icon className="size-[22px]" strokeWidth={active ? 1.9 : 1.5} />
      {label}
    </>
  );
  return href ? (
    <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

export function MobileTabBar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const newChat = useNewChat();
  const [more, setMore] = useState(false);
  const doSignOut = useSignOut();
  const moreActive = isActive(pathname, "/settings") || isActive(pathname, "/connectors");

  return (
    <>
      <AnimatePresence>
        {more && (
          <motion.div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)}>
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="absolute inset-x-0 bottom-0 max-h-[82dvh] overflow-y-auto rounded-t-3xl bg-canvas p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-float"
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-fill-strong" />
              <div className="mb-3 flex items-center gap-3 rounded-2xl bg-surface p-3 ring-1 ring-hairline">
                <Avatar name={user.name || user.email} src={user.image} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-medium">{user.name}</p>
                  <p className="truncate text-[13px] text-ink-2">{user.email}</p>
                </div>
              </div>
              <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-hairline">
                <Link href="/connectors" onClick={() => setMore(false)} className="flex items-center gap-3 border-b border-hairline px-4 py-3 text-[15px]">
                  <Plug className="size-5 text-ink-2" strokeWidth={1.5} /> Connectors
                </Link>
                <Link href="/settings" onClick={() => setMore(false)} className="flex items-center gap-3 border-b border-hairline px-4 py-3 text-[15px]">
                  <Settings className="size-5 text-ink-2" strokeWidth={1.5} /> Settings
                </Link>
                <button onClick={doSignOut} className="flex w-full items-center gap-3 px-4 py-3 text-left text-[15px] text-bad">
                  <LogOut className="size-5" strokeWidth={1.5} /> Sign out
                </button>
              </div>
              <div className="mt-4 rounded-2xl bg-surface p-3 ring-1 ring-hairline">
                <RecentChats onNavigate={() => setMore(false)} />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="glass pb-safe z-40 flex shrink-0 border-t border-hairline md:hidden" aria-label="Primary">
        {TABS.slice(0, 1).map((t) => (
          <TabButton key={t.href} href={t.href} label={t.label} icon={t.icon} active={isActive(pathname, t.href)} />
        ))}
        <TabButton label="New chat" icon={SquarePen} onClick={newChat} active={pathname.startsWith("/chat/")} />
        {TABS.slice(1).map((t) => (
          <TabButton key={t.href} href={t.href} label={t.label} icon={t.icon} active={isActive(pathname, t.href)} />
        ))}
        <TabButton label="More" icon={Ellipsis} onClick={() => setMore(true)} active={moreActive || more} />
      </nav>
    </>
  );
}
