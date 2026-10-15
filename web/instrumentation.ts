/**
 * In development there is no cron, so poll for due automations once a minute.
 * In production, call POST /api/cron/tick (Bearer CRON_SECRET) from a scheduler (Vercel Cron, etc.).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV !== "development") return;

  if (process.env.JARVIS_LOCAL_EXECUTOR !== "0") (await import("@/lib/device/local-executor")).startLocalExecutor();

  const g = globalThis as unknown as { __jarvisAutomationTimer?: ReturnType<typeof setInterval>; __jarvisTicking?: boolean };
  if (g.__jarvisAutomationTimer) return;

  g.__jarvisAutomationTimer = setInterval(async () => {
    if (g.__jarvisTicking) return;
    g.__jarvisTicking = true;
    try {
      const { tickDueAutomations } = await import("@/lib/automations/runner");
      const results = await tickDueAutomations();
      if (results.length) console.log("[automations] tick ran:", results.map((r) => `${r.name}=${r.status}`).join(", "));
    } catch (e) {
      console.warn("[automations] tick failed:", e instanceof Error ? e.message : e);
    } finally {
      g.__jarvisTicking = false;
    }
  }, 60_000);
  g.__jarvisAutomationTimer.unref?.();
}
