"use client";

import { useMemo } from "react";
import { ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { useSignOut } from "@/components/shell/UserMenu";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Segmented } from "@/components/ui/Segmented";
import { Skeleton } from "@/components/ui/Skeleton";
import { Switch } from "@/components/ui/Switch";
import { toast } from "@/components/ui/Toaster";
import { api } from "@/components/utils/api";
import { setCached, useApi } from "@/hooks/useApi";
import { useSession } from "@/lib/auth/client";
import { MacCompanion } from "./MacCompanion";

type Settings = { timezone: string; autopilot: boolean; model: string | null };

const MODELS = [
  { value: "gpt-5.4-mini", label: "Fast", hint: "gpt-5.4-mini" },
  { value: "gpt-5.5", label: "Smart", hint: "gpt-5.5" },
] as const;

function Row({ title, description, children, stacked }: { title: string; description?: string; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={stacked ? "px-5 py-4" : "flex items-center justify-between gap-5 px-5 py-4"}>
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] font-medium">{title}</p>
        {description && <p className="mt-0.5 max-w-lg text-[13.5px] leading-snug text-ink-2">{description}</p>}
      </div>
      <div className={stacked ? "mt-3" : "shrink-0"}>{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-2 text-[13px] font-semibold uppercase tracking-wide text-ink-2">{title}</h2>
      <Card className="divide-y divide-hairline overflow-hidden">{children}</Card>
    </section>
  );
}

export function SettingsView() {
  const { data, loading, error, refresh, update } = useApi<Settings>("/api/settings");
  const { data: session } = useSession();
  const signOut = useSignOut();

  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return ["UTC"];
    }
  }, []);
  const deviceZone = typeof window === "undefined" ? undefined : Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function save(patch: Partial<Settings>) {
    const prev = data;
    update((p) => (p ? { ...p, ...patch } : p));
    try {
      const next = await api<Settings>("/api/settings", { method: "PATCH", json: patch });
      setCached("/api/settings", next);
      update(() => next);
      toast.success("Saved");
    } catch (e) {
      update(() => prev);
      toast.error("Couldn't save", { description: (e as Error).message });
    }
  }

  const user = session?.user;
  const model = data?.model && MODELS.some((m) => m.value === data.model) ? data.model : MODELS[0].value;
  const zoneOptions = data && !zones.includes(data.timezone) ? [data.timezone, ...zones] : zones;

  return (
    <PageContainer>
      <PageHeader title="Settings" />
      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      ) : error && !data ? (
        <Card>
          <EmptyState title="Couldn't load settings" description={error.message} action={<Button variant="secondary" onClick={refresh}>Try again</Button>} />
        </Card>
      ) : data ? (
        <div className="space-y-8">
          <Section title="Autonomy">
            <Row
              title="Autopilot"
              description="When off, Jarvis asks before sending emails, inviting people or deleting things. When on, it just does it and shows you what happened."
            >
              <Switch checked={data.autopilot} onChange={(v) => save({ autopilot: v })} label="Autopilot" />
            </Row>
            <div className="flex items-start gap-3 bg-fill/50 px-5 py-3 text-[13px] text-ink-2">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" strokeWidth={1.75} />
              {data.autopilot ? "Autopilot is on. High-impact actions run without asking." : "You stay in control: risky actions wait for your approval."}
            </div>
          </Section>

          <MacCompanion />

          <Section title="Model">
            <Row title="Speed vs. smarts" description="Fast is great for everyday tasks. Smart thinks harder about complex requests." stacked>
              <Segmented
                value={model}
                onChange={(v) => save({ model: v })}
                options={MODELS.map((m) => ({ value: m.value, label: m.label }))}
                className="w-full sm:w-auto [&>button]:flex-1"
              />
              <p className="mt-2 text-[12.5px] text-ink-3">{MODELS.find((m) => m.value === model)?.hint}</p>
            </Row>
          </Section>

          <Section title="Time zone">
            <Row title="Time zone" description="Used for scheduling, “tomorrow morning” and your automations." stacked>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full sm:w-80">
                  <select
                    value={data.timezone}
                    onChange={(e) => save({ timezone: e.target.value })}
                    aria-label="Time zone"
                    className="h-11 w-full appearance-none rounded-xl bg-fill pl-4 pr-10 text-[15px] text-ink focus:outline-none focus:ring-2 focus:ring-accent"
                  >
                    {zoneOptions.map((z) => (
                      <option key={z} value={z}>
                        {z.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.75} />
                </div>
                {deviceZone && deviceZone !== data.timezone && (
                  <Button size="sm" variant="ghost" onClick={() => save({ timezone: deviceZone })}>
                    Use {deviceZone.replace(/_/g, " ")}
                  </Button>
                )}
              </div>
            </Row>
          </Section>

          <Section title="Account">
            <div className="flex items-center gap-4 px-5 py-4">
              <Avatar name={user?.name || user?.email} src={user?.image} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-semibold">{user?.name || "Your account"}</p>
                <p className="truncate text-[14px] text-ink-2">{user?.email}</p>
              </div>
            </div>
            <div className="px-5 py-3">
              <Button variant="danger" onClick={signOut} icon={<LogOut className="size-4" strokeWidth={1.75} />}>
                Sign out
              </Button>
            </div>
          </Section>
        </div>
      ) : null}
    </PageContainer>
  );
}
