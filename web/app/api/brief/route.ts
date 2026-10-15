import { getBrief } from "@/lib/agent/brief";
import { authed, json } from "@/lib/security/http";
import { enforce, LIMITS } from "@/lib/security/ratelimit";

export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const limited = await enforce(user.id, [LIMITS.brief]);
  if (limited) return limited;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  try {
    return json(await getBrief(user.id, { refresh }));
  } catch (e) {
    console.error("[brief] failed:", e instanceof Error ? e.message : e);
    return json({
      greeting: "Hello.", summary: "I couldn't load your day just now.", connected: false,
      events: [], emails: [], tasks: [], generatedAt: new Date().toISOString(),
    });
  }
}
