import { z } from "zod";
import { requireApiSession } from "@/lib/auth/session";

export interface ApiUser {
  id: string;
  name: string;
  email: string;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json", "cache-control": "no-store", ...(init.headers ?? {}) } });
}

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return json({ error, ...extra }, { status });
}

/** Session user or a 401 Response. Usage: const u = await authed(); if (u instanceof Response) return u; */
export async function authed(): Promise<ApiUser | Response> {
  const s = await requireApiSession();
  if (s instanceof Response) return s;
  return { id: s.user.id, name: s.user.name, email: s.user.email };
}

/** Parse + validate a JSON body. Returns the data or a 400 Response. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S> | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, "invalid_json");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, "invalid_body", { issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".") || "body"}: ${i.message}`) });
  }
  return parsed.data;
}

export function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
