import type { AutomationRow } from "@/lib/automations/runner";

export function serializeAutomation(a: AutomationRow) {
  return {
    id: a.id,
    name: a.name,
    trigger: a.trigger,
    instructions: a.instructions,
    enabled: a.enabled,
    lastRunAt: a.lastRunAt,
    nextRunAt: a.nextRunAt,
    lastStatus: a.lastStatus,
    createdAt: a.createdAt,
  };
}
