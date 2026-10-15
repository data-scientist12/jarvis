"use client";

import { useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import { Plus, Sparkles, Zap } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toaster";
import { api } from "@/components/utils/api";
import { mutate, useApi } from "@/hooks/useApi";
import { AutomationCard } from "./AutomationCard";
import { recipeIcon } from "./recipeIcon";
import type { Automation, Recipe } from "./types";

export function AutomationsView() {
  const list = useApi<{ automations: Automation[] }>("/api/automations", {
    interval: (d) => (d?.automations.some((a) => a.lastStatus === "running") ? 4000 : false),
  });
  const recipes = useApi<{ recipes: Recipe[] }>("/api/automations/recipes");
  const [prompt, setPrompt] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<Automation | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function create(text: string) {
    const { automation } = await api<{ automation: Automation }>("/api/automations", { method: "POST", json: { prompt: text } });
    list.update((prev) => ({ automations: [automation, ...(prev?.automations ?? [])] }));
    mutate("/api/stats");
    toast.success("Automation created", { description: automation.name });
    return automation;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      await create(text);
      setPrompt("");
    } catch (err) {
      toast.error("Couldn't create that automation", { description: (err as Error).message });
    } finally {
      setCreating(false);
    }
  }

  async function addRecipe(r: Recipe) {
    setAdding(r.id);
    try {
      await create(r.prompt);
      setAdded((s) => new Set(s).add(r.id));
    } catch (err) {
      toast.error(`Couldn't add “${r.name}”`, { description: (err as Error).message });
    } finally {
      setAdding(null);
    }
  }

  async function toggle(a: Automation, enabled: boolean) {
    const patch = (en: boolean) => list.update((prev) => ({ automations: (prev?.automations ?? []).map((x) => (x.id === a.id ? { ...x, enabled: en } : x)) }));
    patch(enabled);
    try {
      const { automation } = await api<{ automation: Automation }>(`/api/automations/${a.id}`, { method: "PATCH", json: { enabled } });
      list.update((prev) => ({ automations: (prev?.automations ?? []).map((x) => (x.id === a.id ? automation : x)) }));
      mutate("/api/stats");
    } catch (err) {
      patch(!enabled);
      toast.error("Couldn't update the automation", { description: (err as Error).message });
    }
  }

  async function run(a: Automation) {
    try {
      const { runId } = await api<{ runId: string }>(`/api/automations/${a.id}/run`, { method: "POST" });
      toast.success(`Running “${a.name}”`, { action: { label: "View", href: `/activity/${runId}` } });
      list.update((prev) => ({ automations: (prev?.automations ?? []).map((x) => (x.id === a.id ? { ...x, lastStatus: "running" } : x)) }));
      mutate("/api/runs");
    } catch (err) {
      toast.error("Couldn't start the run", { description: (err as Error).message });
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/api/automations/${toDelete.id}`, { method: "DELETE" });
      list.update((prev) => ({ automations: (prev?.automations ?? []).filter((x) => x.id !== toDelete.id) }));
      mutate("/api/stats");
      setToDelete(null);
    } catch (err) {
      toast.error("Couldn't delete it", { description: (err as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  const automations = list.data?.automations ?? [];

  return (
    <PageContainer>
      <PageHeader title="Automations" subtitle="Hand off the repetitive stuff. Describe it once and Jarvis runs it on schedule." />

      <Card className="p-4 sm:p-5">
        <form onSubmit={onCreate} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Sparkles className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-accent" strokeWidth={1.5} />
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Every weekday at 8am, email me my brief"
              aria-label="Describe an automation"
              className="pl-11"
              maxLength={600}
            />
          </div>
          <Button type="submit" size="lg" loading={creating} disabled={!prompt.trim()} icon={<Plus className="size-4" strokeWidth={2} />}>
            Create
          </Button>
        </form>
        <p className="mt-2.5 px-1 text-[13px] text-ink-3">Describe when it should run and what Jarvis should do. Jarvis works out the rest.</p>
      </Card>

      <section className="mt-10">
        <h2 className="mb-3 px-1 text-[20px] font-semibold tracking-tight">Your automations</h2>
        {list.loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        ) : list.error && !list.data ? (
          <Card>
            <EmptyState title="Couldn't load automations" description={list.error.message} action={<Button variant="secondary" onClick={list.refresh}>Try again</Button>} />
          </Card>
        ) : automations.length === 0 ? (
          <Card>
            <EmptyState icon={<Zap />} title="No automations yet" description="Describe one above, or start from a recipe below." />
          </Card>
        ) : (
          <div className="space-y-4">
            <AnimatePresence initial={false} mode="popLayout">
              {automations.map((a) => (
                <AutomationCard key={a.id} automation={a} onToggle={(en) => toggle(a, en)} onRun={() => run(a)} onDelete={() => setToDelete(a)} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="mb-3 px-1 text-[20px] font-semibold tracking-tight">Recipes</h2>
        {recipes.loading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(recipes.data?.recipes ?? []).map((r) => {
              const { Icon, color } = recipeIcon(r.icon, r.connectors);
              const isAdded = added.has(r.id);
              return (
                <Card key={r.id} className="flex flex-col p-5">
                  <div className="flex items-start gap-3.5">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
                      <Icon className="size-[22px]" strokeWidth={1.5} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-[16px] font-semibold leading-snug tracking-tight">{r.name}</h3>
                      <p className="mt-1 text-[14px] leading-snug text-ink-2">{r.description}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-end">
                    <Button size="sm" variant={isAdded ? "secondary" : "primary"} loading={adding === r.id} disabled={isAdded} onClick={() => addRecipe(r)}>
                      {isAdded ? "Added" : "Add"}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this automation?"
        description={toDelete ? `“${toDelete.name}” will stop running. Past runs stay in Activity.` : undefined}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </PageContainer>
  );
}
