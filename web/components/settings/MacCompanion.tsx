"use client";

import { useState } from "react";
import { Check, Copy, Laptop, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { toast } from "@/components/ui/Toaster";
import { api } from "@/components/utils/api";
import { useApi } from "@/hooks/useApi";

type Devices = { localExecutor: boolean; devices: { id: string; name: string; online: boolean; lastSeenAt: string | null }[] };

/** Settings section: lets Jarvis open apps and Chrome tabs on the user's Mac. */
export function MacCompanion() {
  const { data, refresh } = useApi<Devices>("/api/device/pair", { interval: 5000 });
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const command = token ? `cd web && npm run companion -- --url ${origin} --token ${token}` : "";

  async function pair() {
    setBusy(true);
    try {
      const res = await api<{ token: string }>("/api/device/pair", { method: "POST", json: { name: "My Mac" } });
      setToken(res.token);
      refresh();
    } catch (e) {
      toast.error("Couldn't pair", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function remove(id: string) {
    await api(`/api/device/pair?id=${id}`, { method: "DELETE" });
    refresh();
  }

  const anyOnline = data?.localExecutor || data?.devices.some((d) => d.online);

  return (
    <section>
      <h2 className="mb-2 px-2 text-[13px] font-semibold uppercase tracking-wide text-ink-2">Mac companion</h2>
      <Card className="divide-y divide-hairline overflow-hidden">
        <div className="flex items-center justify-between gap-5 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <Laptop className="mt-0.5 size-5 shrink-0 text-ink-2" strokeWidth={1.5} />
            <div>
              <p className="text-[15.5px] font-medium">Let Jarvis control this Mac</p>
              <p className="mt-0.5 max-w-lg text-[13.5px] leading-snug text-ink-2">
                Open apps, open and switch Chrome tabs, and open files just by asking. {data?.localExecutor ? "You're running Jarvis on this Mac, so it's already connected." : "Run a small companion on your Mac and Jarvis can reach it from anywhere."}
              </p>
            </div>
          </div>
          <Badge tone={anyOnline ? "ok" : "neutral"}>{anyOnline ? "Connected" : "Not connected"}</Badge>
        </div>

        {data?.devices.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-2.5 text-[14.5px]">
              <span className={`size-2 rounded-full ${d.online ? "bg-ok" : "bg-ink-3"}`} />
              {d.name}
              <span className="text-[12.5px] text-ink-3">{d.online ? "online" : "offline"}</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => remove(d.id)} aria-label={`Remove ${d.name}`} icon={<Trash2 className="size-4" strokeWidth={1.6} />} />
          </div>
        ))}

        {!data?.localExecutor && (
          <div className="space-y-3 px-5 py-4">
            {token ? (
              <>
                <p className="text-[13.5px] text-ink-2">Run this in a terminal on your Mac and leave it open. This token is shown once.</p>
                <div className="flex items-start gap-2 rounded-xl bg-fill p-3">
                  <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed">{command}</code>
                  <Button size="sm" variant="secondary" onClick={copy} icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="secondary" onClick={pair} loading={busy}>
                Connect a Mac
              </Button>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
