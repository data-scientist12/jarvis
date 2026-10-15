import { Suspense } from "react";
import { Orb } from "@/components/orb/Orb";
import { Features } from "@/components/marketing/Features";
import { HeroActions, HeroActionsFallback } from "@/components/marketing/HeroActions";
import { MarketingFooter, MarketingNav } from "@/components/marketing/Chrome";

export default function Home() {
  return (
    <>
      <MarketingNav />
      <main>
        <section className="mx-auto flex max-w-5xl flex-col items-center px-5 pb-20 pt-32 text-center sm:pt-40">
          <Orb size={160} />
          <h1 className="mt-14 text-balance text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[72px]">Your day, handled.</h1>
          <p className="mt-5 max-w-2xl text-balance text-[18px] leading-relaxed text-ink-2 sm:text-[21px]">
            Jarvis reads your inbox, schedules your meetings and clears the busywork — across Gmail, Calendar, Meet, Drive and Tasks.
          </p>
          <Suspense fallback={<HeroActionsFallback />}>
            <HeroActions />
          </Suspense>
          <p className="mt-4 text-[13px] text-ink-3">Free while in preview. You stay in control of everything Jarvis does.</p>
        </section>
        <Features />
      </main>
      <MarketingFooter />
    </>
  );
}
