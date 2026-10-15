"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";
import { GoogleIcon } from "./GoogleIcon";

/** "Continue with Google". `googleConfigured` comes from the server (lib/auth) so the hint is accurate. */
export function GoogleButton({
  googleConfigured,
  callbackURL = "/dashboard",
  size = "lg",
  label = "Continue with Google",
  onError,
  fullWidth = true,
}: {
  googleConfigured: boolean;
  callbackURL?: string;
  size?: "md" | "lg";
  label?: string;
  onError?: (message: string) => void;
  fullWidth?: boolean;
}) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    try {
      const res = await signIn.social({ provider: "google", callbackURL });
      if (res?.error) {
        onError?.(res.error.message ?? "Couldn't start Google sign-in.");
        setLoading(false);
      }
      // On success the browser is redirected to Google; keep the spinner.
    } catch {
      onError?.("Couldn't reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className={fullWidth ? "w-full" : "w-full sm:w-auto"}>
      <Button
        size={size}
        className={fullWidth ? "w-full" : "w-full sm:w-auto"}
        onClick={go}
        loading={loading}
        disabled={!googleConfigured}
        icon={
          <span className="flex size-6 items-center justify-center rounded-full bg-white">
            <GoogleIcon size={14} />
          </span>
        }
      >
        {label}
      </Button>
      {!googleConfigured && <p className="mt-2 text-center text-[13px] text-ink-3">Google sign-in isn&apos;t configured yet.</p>}
    </div>
  );
}
