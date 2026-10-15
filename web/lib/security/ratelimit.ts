import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface LimitOptions {
  max: number;
  windowSec: number;
}
export interface LimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the caller may retry (0 when ok). */
  retryAfter: number;
}

const hasUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

const g = globalThis as unknown as {
  __jarvisRl?: Map<string, Ratelimit>;
  __jarvisMem?: Map<string, number[]>;
  __jarvisRedis?: Redis;
};
const limiters = (g.__jarvisRl ??= new Map());
const memory: Map<string, number[]> = (g.__jarvisMem ??= new Map<string, number[]>());

function upstashFor(opts: LimitOptions) {
  const k = `${opts.max}:${opts.windowSec}`;
  let rl = limiters.get(k);
  if (!rl) {
    const redis = (g.__jarvisRedis ??= new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    }));
    rl = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(opts.max, `${opts.windowSec} s`),
      prefix: `jarvis:rl:${k}`,
    });
    limiters.set(k, rl);
  }
  return rl;
}

function memoryLimit(key: string, opts: LimitOptions): LimitResult {
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const hits = (memory.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (hits.length >= opts.max) {
    memory.set(key, hits);
    return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }
  hits.push(now);
  memory.set(key, hits);
  // Opportunistic cleanup so the map doesn't grow forever.
  if (memory.size > 5000) {
    for (const [k, v] of memory) if (!v.length || now - v[v.length - 1] > 24 * 3600 * 1000) memory.delete(k);
  }
  return { ok: true, remaining: opts.max - hits.length, retryAfter: 0 };
}

/** Sliding-window rate limit. Uses Upstash when configured, otherwise an in-memory fallback (per instance). */
export async function limit(key: string, opts: LimitOptions): Promise<LimitResult> {
  if (hasUpstash) {
    try {
      const r = await upstashFor(opts).limit(key);
      return { ok: r.success, remaining: r.remaining, retryAfter: r.success ? 0 : Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
    } catch (e) {
      console.warn("[ratelimit] upstash failed, falling back to memory:", e instanceof Error ? e.message : e);
    }
  }
  return memoryLimit(`${opts.max}:${opts.windowSec}:${key}`, opts);
}

/** Standard 429 response body. */
export function rateLimited(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: "rate_limited", retryAfter }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfter) },
  });
}

/** Apply several limits; returns a 429 Response for the first one exceeded, or null. */
export async function enforce(userId: string, checks: { name: string; opts: LimitOptions }[]): Promise<Response | null> {
  for (const c of checks) {
    const r = await limit(`${c.name}:${userId}`, c.opts);
    if (!r.ok) return rateLimited(r.retryAfter);
  }
  return null;
}

export const LIMITS = {
  chatMinute: { name: "chat:min", opts: { max: 20, windowSec: 60 } },
  chatDay: { name: "chat:day", opts: { max: 300, windowSec: 86400 } },
  transcribe: { name: "transcribe", opts: { max: 30, windowSec: 60 } },
  speak: { name: "speak", opts: { max: 30, windowSec: 60 } },
  automationCreate: { name: "auto:create", opts: { max: 20, windowSec: 86400 } },
  automationRun: { name: "auto:run", opts: { max: 20, windowSec: 3600 } },
  brief: { name: "brief", opts: { max: 30, windowSec: 60 } },
} as const;
