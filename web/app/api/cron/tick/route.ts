import { timingSafeEqual } from "node:crypto";
import { tickDueAutomations } from "@/lib/automations/runner";
import { json, jsonError } from "@/lib/security/http";

export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: Request) {
  if (!authorized(req)) return jsonError(401, "unauthorized");
  const ran = await tickDueAutomations();
  return json({ ok: true, ran });
}

export const POST = handle;
// Vercel Cron issues GET requests.
export const GET = handle;
