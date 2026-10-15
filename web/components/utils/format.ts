/** Small, dependency-free formatting helpers shared by the UI. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null) return null;
  if (typeof v === "string") {
    // Date-only values are local calendar dates (not UTC midnight).
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "just now", "5m ago", "in 2h", "Yesterday", "Mar 4". */
export function relativeTime(v: string | number | Date | null | undefined, now = Date.now()): string {
  const d = toDate(v);
  if (!d) return "";
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const future = diff > 0;
  if (abs < 45_000) return future ? "in a moment" : "just now";
  if (abs < HOUR) {
    const m = Math.max(1, Math.round(abs / MIN));
    return future ? `in ${m}m` : `${m}m ago`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return future ? `in ${h}h` : `${h}h ago`;
  }
  if (abs < 2 * DAY) return future ? "Tomorrow" : "Yesterday";
  if (abs < 7 * DAY) {
    const days = Math.round(abs / DAY);
    return future ? `in ${days}d` : `${days}d ago`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  return d ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
}

export function formatDateTime(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDay(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const tomorrow = new Date(today.getTime() + DAY);
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** "10:00 – 10:30 AM" style range (date-only values render as "All day"). */
export function formatRange(start: string, end?: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return "All day";
  const s = toDate(start);
  const e = toDate(end);
  if (!s) return "";
  const fmt = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!e) return fmt(s);
  return `${fmt(s)} – ${fmt(e)}`;
}

export function formatDue(v: string | undefined): string {
  if (!v) return "";
  const d = toDate(v);
  if (!d) return v;
  return formatDay(d);
}

export function initials(nameOrEmail: string | null | undefined): string {
  const s = (nameOrEmail ?? "").trim();
  if (!s) return "?";
  const base = s.includes("@") ? s.split("@")[0] : s;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  const out = (parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return out.toUpperCase() || "?";
}

/** "Priya Shah <priya@x.com>" -> "Priya Shah"; falls back to the address. */
export function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) return m[1].trim() || m[2];
  return from.trim();
}

export function greetingForNow(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Deterministic hue for avatars. */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

const DOW = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

function clock(h: number, m: number): string {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Human description of a 5-field cron expression (common shapes only). */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return cron;
  const [min, hour, dom, mon, dow] = parts;
  const m = Number(min);
  const h = Number(hour);
  if (min.startsWith("*/") && hour === "*") return `Every ${min.slice(2)} minutes`;
  if (min === "0" && hour.startsWith("*/")) return `Every ${hour.slice(2)} hours`;
  if (Number.isFinite(m) && hour === "*") return `Hourly at :${String(m).padStart(2, "0")}`;
  if (!Number.isFinite(m) || !Number.isFinite(h)) return cron;
  const at = clock(h, m);
  if (dom === "*" && mon === "*") {
    if (dow === "*") return `Every day at ${at}`;
    if (dow === "1-5") return `Weekdays at ${at}`;
    if (dow === "0,6" || dow === "6,0") return `Weekends at ${at}`;
    const days = dow.split(",").map((x) => DOW[Number(x) % 7]).filter(Boolean);
    if (days.length) return `${days.join(", ")} at ${at}`;
  }
  if (mon === "*" && dow === "*" && /^\d+$/.test(dom)) return `Monthly on day ${dom} at ${at}`;
  return cron;
}

/** Human-readable automation trigger from `{ type: "schedule" | "gmail" | "manual", ... }`. */
export function describeTrigger(trigger: unknown): string {
  if (!trigger) return "Manual";
  if (typeof trigger === "string") return trigger;
  const t = trigger as Record<string, unknown>;
  const type = String(t.type ?? t.kind ?? "manual");
  if (type === "schedule") {
    if (typeof t.cron === "string") return describeCron(t.cron);
    if (typeof t.description === "string") return t.description;
    return "On a schedule";
  }
  if (type === "gmail" || type === "email") {
    const q = typeof t.query === "string" && t.query ? `matches ${t.query}` : "arrives";
    return `When new email ${q}`;
  }
  return "Manual";
}
