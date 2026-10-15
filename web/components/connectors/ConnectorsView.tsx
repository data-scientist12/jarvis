"use client";

import { useState } from "react";
import { Check, CircleCheck, Copy } from "lucide-react";
import { ConnectGoogleButton } from "@/components/shell/ConnectBanner";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { toolMeta } from "@/components/timeline/toolMeta";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useApi } from "@/hooks/useApi";

type ConnectorsData = {
  googleConfigured: boolean;
  googleConnected: boolean;
  googleEmail?: string;
  connectors: { id: string; name: string; description: string; granted: boolean }[];
};

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl bg-fill px-3 py-2">
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono text-[12.5px] text-ink">{value}</code>
      <button
        type="button"
        aria-label="Copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          } catch {
            /* clipboard unavailable */
          }
        }}
        className="shrink-0 rounded-md p-1 text-ink-3 hover:bg-fill-strong hover:text-ink-2"
      >
        {copied ? <Check className="size-4" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.5} />}
      </button>
    </div>
  );
}

function SetupPanel() {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Badge tone="warn">Setup needed</Badge>
        <h2 className="text-[17px] font-semibold tracking-tight">Connect your Google OAuth client</h2>
      </div>
      <p className="mt-2 text-[14px] text-ink-2">Jarvis isn&apos;t configured for Google yet. It takes about five minutes:</p>
      <ol className="mt-4 space-y-4 text-[14px] text-ink-2">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-ink">1</span>
          <span>
            In Google Cloud Console, create an <strong className="text-ink">OAuth client ID</strong> (type: Web application), and enable the Gmail, Calendar, Drive, Tasks, People and Meet APIs.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-ink">2</span>
          <div className="min-w-0 flex-1 space-y-2">
            <span>Add this as an authorized redirect URI:</span>
            <CopyField value="http://localhost:3000/api/auth/callback/google" />
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-ink">3</span>
          <div className="min-w-0 flex-1 space-y-2">
            <span>
              Put the credentials in <code className="rounded bg-fill px-1.5 py-0.5 font-mono text-[12.5px] text-ink">.env.local</code>:
            </span>
            <CopyField value={"GOOGLE_CLIENT_ID=…\nGOOGLE_CLIENT_SECRET=…"} />
          </div>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fill text-[12px] font-semibold text-ink">4</span>
          <span>Restart the dev server, then come back here and connect.</span>
        </li>
      </ol>
    </Card>
  );
}

export function ConnectorsView() {
  const { data, loading, error, refresh } = useApi<ConnectorsData>("/api/connectors");

  return (
    <PageContainer>
      <PageHeader title="Connectors" subtitle="Choose which Google apps Jarvis can work in. You can revoke access any time from your Google account." />

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : error && !data ? (
        <Card>
          <EmptyState title="Couldn't load connectors" description={error.message} action={<Button variant="secondary" onClick={refresh}>Try again</Button>} />
        </Card>
      ) : data ? (
        <div className="space-y-6">
          <Card className="flex flex-wrap items-center gap-4 p-5">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-soft ring-1 ring-black/10">
              <GoogleIcon size={26} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[16px] font-semibold">Google account</p>
              <p className="truncate text-[14px] text-ink-2">{data.googleConnected ? data.googleEmail || "Connected" : data.googleConfigured ? "Not connected" : "Not configured"}</p>
            </div>
            {data.googleConnected ? (
              <Badge tone="ok" icon={<Check className="size-3" strokeWidth={3} />}>
                Connected
              </Badge>
            ) : data.googleConfigured ? (
              <ConnectGoogleButton label="Connect Google" size="md" />
            ) : null}
          </Card>

          {!data.googleConfigured && <SetupPanel />}

          <Card className="overflow-hidden">
            <ul className="divide-y divide-hairline">
              {data.connectors.map((c) => {
                const m = toolMeta(c.id);
                const Icon = m.icon;
                return (
                  <li key={c.id} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }}>
                      <Icon className="size-5" strokeWidth={1.5} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-medium">{c.name}</p>
                      <p className="text-[13px] text-ink-3">{c.description}</p>
                    </div>
                    {c.granted ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-[13.5px] font-medium text-[#1f8a3b] dark:text-ok">
                        <CircleCheck className="size-5" strokeWidth={1.75} /> <span className="hidden sm:inline">Granted</span>
                      </span>
                    ) : data.googleConfigured ? (
                      <ConnectGoogleButton label="Grant access" variant="secondary" />
                    ) : (
                      <Badge>Unavailable</Badge>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
          <p className="px-1 text-[13px] text-ink-3">Granting access asks Google to re-confirm all permissions in one step.</p>
        </div>
      ) : null}
    </PageContainer>
  );
}
