import { redirect } from "next/navigation";
import { googleConfigured } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { AuthForm } from "./AuthForm";

/** Only same-origin relative paths are allowed as post-login targets. */
export function safeNext(next: string | string[] | undefined): string {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return "/dashboard";
  return v;
}

/** Server component (render inside <Suspense>): redirects signed-in users, otherwise shows the form. */
export async function AuthGate({ mode, searchParams }: { mode: "login" | "signup"; searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  const target = safeNext(next);
  const session = await getSession();
  if (session) redirect(target);
  return <AuthForm mode={mode} googleConfigured={googleConfigured} next={target} />;
}
