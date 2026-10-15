"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SquarePen } from "lucide-react";
import { cn } from "@/components/utils/cn";
import { Orb } from "@/components/orb/Orb";
import { newChatId, useChatStore } from "@/hooks/useChatStore";
import { NAV } from "./nav";
import { RecentChats } from "./RecentChats";
import { UserMenu, type ShellUser } from "./UserMenu";

export function useNewChat() {
  const router = useRouter();
  const start = useChatStore((s) => s.start);
  return () => {
    const id = newChatId();
    start(id, null);
    router.push(`/chat/${id}`);
  };
}

export function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const newChat = useNewChat();
  return (
    <aside className="glass hidden h-dvh w-[272px] shrink-0 flex-col border-r border-hairline md:flex">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-5">
        <Link href="/dashboard" className="flex items-center gap-2.5 text-[18px] font-semibold tracking-tight">
          <Orb size={26} />
          Jarvis
        </Link>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={newChat}
          className="flex w-full items-center gap-2.5 rounded-xl bg-accent px-3 py-2 text-[14px] font-medium text-accent-ink shadow-soft transition-[background-color,transform] hover:bg-accent-hover active:scale-[0.98]"
        >
          <SquarePen className="size-4" strokeWidth={1.75} />
          New chat
        </button>
      </div>

      <nav className="space-y-0.5 px-3 pb-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors",
                active ? "bg-fill-strong font-medium text-ink" : "text-ink-2 hover:bg-fill hover:text-ink",
              )}
            >
              <Icon className={cn("size-[18px]", active && "text-accent")} strokeWidth={1.5} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <RecentChats />
      </div>

      <div className="border-t border-hairline p-3">
        <UserMenu user={user} />
      </div>
    </aside>
  );
}
