import "server-only";
import { claimPending, completeCommand } from "./queue";
import { executeCommand } from "./executor";

/**
 * Development only: the Next dev server runs on the user's own Mac, so it can execute queued commands itself.
 * In production the app is hosted elsewhere and a paired companion (`npm run companion`) does this instead.
 */
export function startLocalExecutor() {
  const g = globalThis as unknown as { __jarvisLocalExecutor?: ReturnType<typeof setInterval>; __jarvisLocalBusy?: boolean };
  if (g.__jarvisLocalExecutor || process.platform !== "darwin") return;
  g.__jarvisLocalExecutor = setInterval(async () => {
    if (g.__jarvisLocalBusy) return;
    g.__jarvisLocalBusy = true;
    try {
      const cmds = await claimPending({ limit: 5 });
      await Promise.all(cmds.map(async (c) => completeCommand(c.id, await executeCommand(c.type, c.payload))));
    } catch (e) {
      console.warn("[device] local executor error:", e instanceof Error ? e.message : e);
    } finally {
      g.__jarvisLocalBusy = false;
    }
  }, 500);
  g.__jarvisLocalExecutor.unref?.();
  console.log("[device] local executor running (this Mac can open apps and Chrome tabs)");
}
