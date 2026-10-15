import Link from "next/link";
import { Orb } from "@/components/orb/Orb";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-tight">
      <Orb size={size} />
      Jarvis
    </span>
  );
}

export function MarketingNav() {
  return (
    <header className="glass fixed inset-x-0 top-0 z-40 border-b border-hairline pt-safe">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
        <Link href="/" aria-label="Jarvis">
          <Logo />
        </Link>
        <nav className="flex items-center gap-5 text-[14px]">
          <Link href="/login" className="text-ink-2 transition-colors hover:text-ink">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-full bg-ink px-3.5 py-1.5 font-medium text-canvas transition-opacity hover:opacity-85">
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-5 py-8 text-[13px] text-ink-3 sm:flex-row">
        <span>Jarvis. Your day, handled.</span>
        <nav className="flex gap-5">
          <Link href="/privacy" className="hover:text-ink-2">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-ink-2">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
