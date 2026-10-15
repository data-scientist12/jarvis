import { MarketingFooter, MarketingNav } from "./Chrome";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <MarketingNav />
      <main className="mx-auto max-w-2xl px-5 pb-24 pt-28">
        <h1 className="text-[36px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-[14px] text-ink-3">Last updated {updated}</p>
        <div className="mt-8 space-y-6 text-[16px] leading-relaxed text-ink-2 [&_a]:text-accent [&_h2]:mb-2 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:text-ink [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>
      </main>
      <MarketingFooter />
    </>
  );
}
