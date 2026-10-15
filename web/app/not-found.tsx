import Link from "next/link";
import { Orb } from "@/components/orb/Orb";
import { buttonClass } from "@/components/ui/buttonClass";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Orb size={96} />
      <h1 className="mt-10 text-[28px] font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-ink-2">That page doesn&apos;t exist or has moved. Let&apos;s get you back to something useful.</p>
      <Link href="/dashboard" className={buttonClass("primary", "md", "mt-6")}>
        Go home
      </Link>
    </main>
  );
}
