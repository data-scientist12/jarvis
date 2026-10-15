"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Composer } from "@/components/chat/Composer";
import { SuggestionChips, type Suggestion } from "@/components/chat/Suggestions";
import { PageContainer } from "@/components/shell/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/components/utils/api";
import { greetingForNow } from "@/components/utils/format";
import { useApi, setCached } from "@/hooks/useApi";
import { newChatId, useChatStore } from "@/hooks/useChatStore";
import { useSession } from "@/lib/auth/client";
import { StatsStrip } from "./StatsStrip";
import type { Brief, Stats } from "./types";
import { InboxWidget, TasksWidget, UpNextWidget } from "./Widgets";

export function DashboardView() {
  const router = useRouter();
  const startChat = useChatStore((s) => s.start);
  const [input, setInput] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const { data: session } = useSession();
  const brief = useApi<Brief>("/api/brief");
  const stats = useApi<Stats>("/api/stats");

  function go(text: string) {
    const id = newChatId();
    startChat(id, text);
    router.push(`/chat/${id}`);
  }

  function pick(s: Suggestion) {
    if (s.fill) setInput(s.prompt);
    else go(s.prompt);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const fresh = await api<Brief>("/api/brief?refresh=1");
      setCached("/api/brief", fresh);
      brief.update(() => fresh);
    } catch {
      /* keep the previous brief */
    } finally {
      setRefreshing(false);
    }
  }

  const firstName = session?.user?.name?.split(" ")[0];
  // Never render a client-clock greeting during SSR/hydration: wait for the API (or fall back after an error).
  const greeting = brief.data?.greeting || (brief.error ? `${greetingForNow()}${firstName ? `, ${firstName}` : ""}` : null);

  const heroTitle = (
    <div className="mb-7 max-w-2xl text-center">
      {greeting ? (
        <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[48px]">{greeting}</h1>
      ) : (
        <Skeleton className="mx-auto h-11 w-72 max-w-full rounded-xl sm:h-[54px]" />
      )}
      {brief.loading || (!brief.data && !brief.error) ? (
        <div className="mx-auto mt-4 max-w-md space-y-2">
          <Skeleton className="mx-auto h-4 w-full" />
          <Skeleton className="mx-auto h-4 w-2/3" />
        </div>
      ) : (
        brief.data?.summary && <p className="mt-3 text-balance text-[16px] leading-relaxed text-ink-2 sm:text-[18px]">{brief.data.summary}</p>
      )}
    </div>
  );

  return (
    <PageContainer wide className="space-y-10 md:pt-12">
      <section className="mx-auto flex max-w-3xl flex-col items-center">
        <Composer variant="hero" value={input} onChange={setInput} onSubmit={go} heroTitle={heroTitle} placeholder="Ask Jarvis to do something…" />
        <SuggestionChips onPick={pick} className="mt-6" />
      </section>

      <section aria-label="This week">
        <StatsStrip stats={stats.data} />
      </section>

      <section aria-label="Today">
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-[20px] font-semibold tracking-tight">Today</h2>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] text-ink-2 transition-colors hover:bg-fill disabled:opacity-60"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} strokeWidth={1.75} />
            Refresh
          </button>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <UpNextWidget brief={brief.data} loading={brief.loading} failed={!!brief.error && !brief.data} />
          <InboxWidget brief={brief.data} loading={brief.loading} failed={!!brief.error && !brief.data} />
          <TasksWidget brief={brief.data} loading={brief.loading} failed={!!brief.error && !brief.data} />
        </div>
      </section>
    </PageContainer>
  );
}
