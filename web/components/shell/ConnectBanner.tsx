"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plug } from "lucide-react";
import { linkSocial } from "@/lib/auth/client";
import { Button } from "@/components/ui/Button";
import { useApi } from "@/hooks/useApi";
import { toast } from "@/components/ui/Toaster";

type Connectors = { googleConfigured: boolean; googleConnected: boolean };

export function ConnectGoogleButton({ label = "Connect", size = "sm", variant = "primary" }: { label?: string; size?: "sm" | "md" | "lg"; variant?: "primary" | "secondary" }) {
  const [loading, setLoading] = useState(false);
  async function go() {
    setLoading(true);
    try {
      const res = await linkSocial({ provider: "google", callbackURL: "/connectors" });
      if (res?.error) {
        toast.error("Couldn't connect Google", { description: res.error.message });
        setLoading(false);
      }
    } catch {
      toast.error("Couldn't connect Google", { description: "Check your connection and try again." });
      setLoading(false);
    }
  }
  return (
    <Button size={size} variant={variant} loading={loading} onClick={go}>
      {label}
    </Button>
  );
}

export function ConnectBanner() {
  const { data } = useApi<Connectors>("/api/connectors");
  const show = !!data && !data.googleConnected;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 34 }}
          className="shrink-0 overflow-hidden"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-accent/8 px-4 py-2.5 md:px-8">
            <Plug className="size-[18px] shrink-0 text-accent" strokeWidth={1.5} />
            <p className="min-w-0 flex-1 text-[14px] text-ink">
              {data?.googleConfigured ? "Connect Google to let Jarvis work in Gmail, Calendar and Drive" : "Finish setting up Google to let Jarvis work in Gmail, Calendar and Drive"}
            </p>
            {data?.googleConfigured ? (
              <ConnectGoogleButton />
            ) : (
              <Link href="/connectors" className="text-[14px] font-medium text-accent">
                See how
              </Link>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
