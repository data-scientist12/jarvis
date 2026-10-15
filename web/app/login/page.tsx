import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthGate } from "@/components/auth/AuthGate";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <AuthGate mode="login" searchParams={searchParams} />
    </Suspense>
  );
}
