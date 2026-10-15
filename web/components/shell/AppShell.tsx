"use client";

import { ConnectBanner } from "./ConnectBanner";
import { MobileTabBar } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import type { ShellUser } from "./UserMenu";

/** Translucent sidebar on desktop; bottom tab bar on phones. `main` is the scroll container. */
export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <Sidebar user={user} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ConnectBanner />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</main>
        <MobileTabBar user={user} />
      </div>
    </div>
  );
}

export function ShellSkeleton() {
  return (
    <div className="flex h-dvh">
      <div className="glass hidden w-[272px] shrink-0 border-r border-hairline md:block" />
      <div className="flex-1" />
    </div>
  );
}
