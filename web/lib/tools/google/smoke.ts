/**
 * Read-only smoke test for the Google connector tools.
 *
 *   USER_ID=<better-auth user id> npx tsx --conditions=react-server lib/tools/google/smoke.ts
 *
 * `--conditions=react-server` makes `import "server-only"` (in lib/google/client.ts) a no-op outside Next.
 * Optional env: TZ_NAME (default Asia/Kolkata), CONTACT_NAME (default "a").
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

async function main() {
  const userId = process.env.USER_ID;
  if (!userId) {
    console.error("Set USER_ID to a user id from the `user` table.");
    process.exit(1);
  }
  // Dynamic imports so env is loaded before the db pool / auth are created.
  const { getGoogleAuth, getGrantedConnectors } = await import("@/lib/google/client");
  const { db, schema } = await import("@/lib/db");
  const { eq } = await import("drizzle-orm");
  const { googleTools } = await import("./index");

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, userId)).limit(1);
  if (!u) {
    console.error(`No user ${userId}`);
    process.exit(1);
  }
  const granted = await getGrantedConnectors(userId);
  console.log(`User: ${u.email}  granted connectors: ${granted.join(", ") || "(none)"}\n`);

  const ctx = {
    userId,
    userName: u.name,
    userEmail: u.email,
    timezone: process.env.TZ_NAME ?? "Asia/Kolkata",
    now: new Date(),
    google: () => getGoogleAuth(userId),
  };

  const calls: [string, unknown][] = [
    ["gmail_search", { query: "newer_than:7d", max: 5 }],
    ["gmail_list_labels", {}],
    ["gmail_find_unreplied", { days: 3, max: 5 }],
    ["gmail_list_subscriptions", { days: 14, max: 5 }],
    ["calendar_list_events", {}],
    ["calendar_find_free_slots", { durationMinutes: 30, windowStart: ctx.now.toISOString().slice(0, 10), windowEnd: new Date(ctx.now.getTime() + 7 * 864e5).toISOString().slice(0, 10) }],
    ["tasks_list", {}],
    ["tasks_list_tasklists", {}],
    ["drive_search", { query: "", type: "any", max: 5 }],
    ["contacts_search", { name: process.env.CONTACT_NAME ?? "a" }],
  ];

  let failures = 0;
  for (const [name, raw] of calls) {
    const tool = googleTools.find((t) => t.name === name);
    if (!tool) {
      console.log(`✗ ${name}: tool not registered`);
      failures++;
      continue;
    }
    if (!granted.includes(tool.connector as never)) {
      console.log(`- ${name}: skipped (connector "${tool.connector}" not granted)`);
      continue;
    }
    const t0 = Date.now();
    const input = tool.inputSchema.parse(raw);
    const res = await tool.execute(input, ctx);
    if (!res.ok) failures++;
    console.log(`${res.ok ? "✓" : "✗"} ${name} (${Date.now() - t0}ms): ${res.summary}${res.error ? `  [${res.error}] ${res.suggestion ?? ""}` : ""}`);
  }
  console.log(failures ? `\n${failures} failure(s)` : "\nAll read-only tools OK");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
