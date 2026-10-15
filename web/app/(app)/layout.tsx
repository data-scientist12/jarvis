import { Suspense } from "react";
import { requireSession } from "@/lib/auth/session";
import { AppShell, ShellSkeleton } from "@/components/shell/AppShell";

async function SessionShell({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const { name, email, image } = session.user;
  return (
    <AppShell user={{ name, email, image: image ?? null }}>
      {children}
    </AppShell>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <SessionShell>{children}</SessionShell>
    </Suspense>
  );
}
