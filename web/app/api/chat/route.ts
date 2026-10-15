import { z } from "zod";
import type { UIMessage } from "ai";
import { streamChat } from "@/lib/agent/engine";
import { ensureProfile } from "@/lib/agent/context";
import { budgetExceededResponse, isOverBudget } from "@/lib/security/budget";
import { authed, jsonError, readJson } from "@/lib/security/http";
import { enforce, LIMITS } from "@/lib/security/ratelimit";

export const maxDuration = 300;

const bodySchema = z.object({
  id: z.string().min(1).max(80),
  messages: z.array(z.looseObject({ id: z.string().optional(), role: z.enum(["user", "assistant", "system"]), parts: z.array(z.looseObject({ type: z.string() })) })).min(1).max(200),
  timezone: z.string().max(64).optional(),
});

export async function POST(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;

  const limited = await enforce(user.id, [LIMITS.chatMinute, LIMITS.chatDay]);
  if (limited) return limited;
  if (await isOverBudget(user.id)) return budgetExceededResponse();

  const body = await readJson(req, bodySchema);
  if (body instanceof Response) return body;
  if (body.messages.some((m) => m.role === "system")) return jsonError(400, "invalid_messages");

  await ensureProfile(user.id, body.timezone);
  return streamChat({
    session: { user },
    conversationId: body.id,
    messages: body.messages as unknown as UIMessage[],
    timezone: body.timezone,
  });
}
