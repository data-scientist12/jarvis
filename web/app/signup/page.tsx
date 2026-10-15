import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthGate } from "@/components/auth/AuthGate";

export const metadata: Metadata = { title: "Create account" };

export default function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <AuthGate mode="signup" searchParams={searchParams} />
    </Suspense>
  );
}
