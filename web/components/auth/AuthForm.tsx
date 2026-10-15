"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { signIn, signUp } from "@/lib/auth/client";
import { Orb } from "@/components/orb/Orb";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { GoogleButton } from "./GoogleButton";

type Mode = "login" | "signup";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthForm({ mode, googleConfigured, next }: { mode: Mode; googleConfigured: boolean; next: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [orb, setOrb] = useState<"idle" | "thinking" | "error" | "success">("idle");

  const isSignup = mode === "signup";
  const other = isSignup ? "/login" : "/signup";
  const otherHref = next && next !== "/dashboard" ? `${other}?next=${encodeURIComponent(next)}` : other;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors: typeof errors = {};
    if (isSignup && name.trim().length < 1) nextErrors.name = "Enter your name.";
    if (!EMAIL_RE.test(email.trim())) nextErrors.email = "Enter a valid email address.";
    if (password.length < 8) nextErrors.password = "Use at least 8 characters.";
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length) {
      setOrb("error");
      return;
    }
    setLoading(true);
    setOrb("thinking");
    try {
      const res = isSignup
        ? await signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: next })
        : await signIn.email({ email: email.trim(), password, callbackURL: next });
      if (res.error) {
        setFormError(res.error.message || (isSignup ? "Couldn't create your account." : "Incorrect email or password."));
        setOrb("error");
        setLoading(false);
        return;
      }
      setOrb("success");
      router.push(next);
      router.refresh();
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
      setOrb("error");
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="w-full max-w-[400px]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/" aria-label="Jarvis home">
            <Orb size={72} state={orb} />
          </Link>
          <h1 className="mt-7 text-[28px] font-semibold tracking-tight">{isSignup ? "Create your Jarvis account" : "Sign in to Jarvis"}</h1>
          <p className="mt-1.5 text-[15px] text-ink-2">{isSignup ? "Your day, handled. It takes a minute." : "Welcome back. Pick up where you left off."}</p>
        </div>

        <div className="rounded-3xl bg-surface p-6 shadow-card ring-1 ring-hairline">
          <GoogleButton googleConfigured={googleConfigured} callbackURL={next} onError={setFormError} label={isSignup ? "Sign up with Google" : "Continue with Google"} />

          <div className="my-5 flex items-center gap-3 text-[13px] text-ink-3">
            <span className="h-px flex-1 bg-hairline" />
            or use email
            <span className="h-px flex-1 bg-hairline" />
          </div>

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {isSignup && (
              <Field label="Name" error={errors.name}>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Siddharth" aria-invalid={!!errors.name} />
              </Field>
            )}
            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={!!errors.email}
              />
            </Field>
            <Field label="Password" error={errors.password} hint={isSignup ? "At least 8 characters." : undefined}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder="••••••••"
                aria-invalid={!!errors.password}
              />
            </Field>

            {formError && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} role="alert" className="rounded-xl bg-bad/10 px-3.5 py-2.5 text-[14px] text-bad">
                {formError}
              </motion.p>
            )}

            <Button type="submit" size="lg" variant="secondary" className="w-full" loading={loading}>
              {isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[14px] text-ink-2">
          {isSignup ? "Already have an account?" : "New to Jarvis?"}{" "}
          <Link href={otherHref} className="font-medium text-accent hover:underline">
            {isSignup ? "Sign in" : "Create an account"}
          </Link>
        </p>
        <p className="mt-4 text-center text-[12px] text-ink-3">
          By continuing you agree to the{" "}
          <Link href="/terms" className="underline-offset-2 hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      </motion.div>
    </main>
  );
}
