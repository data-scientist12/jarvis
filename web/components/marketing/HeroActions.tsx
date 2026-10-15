import { redirect } from "next/navigation";
import { googleConfigured } from "@/lib/auth";
import { getSession } from "@/lib/auth/session";
import { GoogleButton } from "@/components/auth/GoogleButton";
import { Button } from "@/components/ui/Button";

/** Server component (render inside <Suspense>): signed-in visitors go straight to the dashboard. */
export async function HeroActions() {
  const session = await getSession();
  if (session) redirect("/dashboard");
  return (
    <div className="mt-9 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-start">
      <GoogleButton googleConfigured={googleConfigured} fullWidth={false} />
      <Button href="/login" size="lg" variant="secondary">
        Sign in with email
      </Button>
    </div>
  );
}

export function HeroActionsFallback() {
  return (
    <div className="mt-9 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row">
      <div className="h-12 w-full animate-skeleton rounded-full bg-fill sm:w-56" />
      <div className="h-12 w-full animate-skeleton rounded-full bg-fill sm:w-48" />
    </div>
  );
}
