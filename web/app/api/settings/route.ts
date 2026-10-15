import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ensureProfile, isValidTimezone } from "@/lib/agent/context";
import { ALLOWED_MODELS, executorModelId } from "@/lib/agent/models";
import { authed, json, readJson } from "@/lib/security/http";


const patchSchema = z.object({
  timezone: z.string().max(64).refine(isValidTimezone, "Invalid timezone").optional(),
  autopilot: z.boolean().optional(),
  model: z.enum(ALLOWED_MODELS).optional(),
});

function shape(p: { timezone: string; autopilot: boolean; model: string | null }) {
  return { timezone: p.timezone, autopilot: p.autopilot, model: executorModelId(p.model) };
}

export async function GET(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const hint = req.headers.get("x-timezone");
  return json(shape(await ensureProfile(user.id, hint)));
}

export async function PATCH(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const body = await readJson(req, patchSchema);
  if (body instanceof Response) return body;
  await ensureProfile(user.id, body.timezone);
  const patch: Partial<typeof schema.profile.$inferInsert> = { updatedAt: new Date() };
  if (body.timezone !== undefined) patch.timezone = body.timezone;
  if (body.autopilot !== undefined) patch.autopilot = body.autopilot;
  if (body.model !== undefined) patch.model = body.model;
  await db.update(schema.profile).set(patch).where(eq(schema.profile.userId, user.id));
  return json(shape(await ensureProfile(user.id)));
}
