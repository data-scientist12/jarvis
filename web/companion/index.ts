/**
 * Jarvis companion — runs on your Mac and lets a hosted Jarvis open apps and Chrome tabs.
 *
 *   npm run companion -- --url https://your-domain.xyz --token jvd_…
 *
 * Get the token from Settings → Mac companion. The companion only makes outbound requests
 * (long-polls the server), so no port forwarding or firewall changes are needed.
 */
import { executeCommand, COMMAND_TYPES } from "../lib/device/executor";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const base = (arg("url") ?? process.env.JARVIS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const token = arg("token") ?? process.env.JARVIS_DEVICE_TOKEN;

if (!token) {
  console.error("Missing --token. Pair this Mac in Jarvis: Settings → Mac companion.");
  process.exit(1);
}

const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Jarvis companion connected to ${base}. Leave this running; press Ctrl+C to stop.`);
  let backoff = 1000;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/device/poll`, { method: "POST", headers, signal: AbortSignal.timeout(30_000) });
      if (res.status === 401) {
        console.error("Token rejected. Pair this Mac again in Settings → Mac companion.");
        process.exit(1);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      backoff = 1000;
      const { commands } = (await res.json()) as { commands: { id: string; type: string; payload: Record<string, unknown> }[] };
      await Promise.all(
        commands.map(async (c) => {
          const outcome = COMMAND_TYPES.includes(c.type as never) ? await executeCommand(c.type, c.payload) : { ok: false, summary: `Unsupported command ${c.type}`, error: "invalid_input" };
          console.log(`${outcome.ok ? "✓" : "✗"} ${c.type}: ${outcome.summary}`);
          await fetch(`${base}/api/device/result`, { method: "POST", headers, body: JSON.stringify({ id: c.id, outcome }) });
        }),
      );
    } catch (e) {
      console.warn(`Connection problem (${e instanceof Error ? e.message : e}); retrying in ${backoff / 1000}s…`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15_000);
    }
  }
}

main();
