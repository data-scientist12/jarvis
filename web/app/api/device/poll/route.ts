import { deviceFromRequest } from "@/lib/device/auth";
import { claimPending } from "@/lib/device/queue";

export const maxDuration = 30;

/** Companion long-poll: returns pending commands for the device's owner (waits up to ~20s). */
export async function POST(req: Request) {
  const dev = await deviceFromRequest(req);
  if (!dev) return Response.json({ error: "unauthorized" }, { status: 401 });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !req.signal.aborted) {
    const commands = await claimPending({ userId: dev.userId, deviceId: dev.id });
    if (commands.length) return Response.json({ commands: commands.map((c) => ({ id: c.id, type: c.type, payload: c.payload })) });
    await new Promise((r) => setTimeout(r, 500));
  }
  return Response.json({ commands: [] });
}
