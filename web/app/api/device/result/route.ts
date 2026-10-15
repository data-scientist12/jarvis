import { z } from "zod";
import { deviceFromRequest } from "@/lib/device/auth";
import { completeCommand } from "@/lib/device/queue";

const body = z.object({
  id: z.string().uuid(),
  outcome: z.object({
    ok: z.boolean(), summary: z.string().max(500), data: z.record(z.string(), z.unknown()).optional(), error: z.string().max(100).optional(),
    suggestion: z.string().max(500).optional(), verified: z.boolean().optional(), evidence: z.string().max(500).optional(),
  }),
});

export async function POST(req: Request) {
  const dev = await deviceFromRequest(req);
  if (!dev) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  await completeCommand(parsed.data.id, parsed.data.outcome, { deviceId: dev.id });
  return Response.json({ ok: true });
}
