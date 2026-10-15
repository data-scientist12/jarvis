/**
 * Runs commands on the machine this process lives on (the user's Mac).
 * Used by (a) the dev server's local executor and (b) the standalone companion (`npm run companion`).
 * No framework imports and no `@/` aliases, so tsx can run it directly.
 */
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type CommandType =
  | "open_url"
  | "open_app"
  | "quit_app"
  | "list_apps"
  | "running_apps"
  | "chrome_tabs"
  | "focus_tab"
  | "close_tab"
  | "open_path";

export const COMMAND_TYPES: CommandType[] = ["open_url", "open_app", "quit_app", "list_apps", "running_apps", "chrome_tabs", "focus_tab", "close_tab", "open_path"];

export interface CommandOutcome {
  ok: boolean;
  summary: string;
  data?: Record<string, unknown>;
  error?: string;
  suggestion?: string;
  /** true = confirmed on the machine; false = ran but the check failed; undefined = nothing to check. */
  verified?: boolean;
  evidence?: string;
}

function run(file: string, args: string[], timeout = 15_000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? "").trim(), stderr: String(stderr ?? err?.message ?? "").trim() });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.toLowerCase().replace(/\.app$/, "").replace(/[^a-z0-9]/g, "");

// ───────────── apps ─────────────

const APP_DIRS = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities", path.join(homedir(), "Applications")];

export function installedApps(): string[] {
  const names = new Set<string>();
  for (const dir of APP_DIRS) {
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".app")) names.add(f.slice(0, -4));
    } catch {
      /* directory missing */
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

const ALIASES: Record<string, string> = {
  chrome: "Google Chrome",
  googlechrome: "Google Chrome",
  vscode: "Visual Studio Code",
  code: "Visual Studio Code",
  settings: "System Settings",
  systempreferences: "System Settings",
  preferences: "System Settings",
  word: "Microsoft Word",
  excel: "Microsoft Excel",
  powerpoint: "Microsoft PowerPoint",
  ppt: "Microsoft PowerPoint",
  whatsapp: "WhatsApp",
  ytmusic: "YouTube Music",
  appstore: "App Store",
  activitymonitor: "Activity Monitor",
  textedit: "TextEdit",
  keynote: "Keynote",
};

/** Maps what a human said ("vs code", "spotify") to an installed app name. */
export function resolveApp(query: string): { name?: string; candidates: string[] } {
  const apps = installedApps();
  const q = norm(query);
  if (!q) return { candidates: [] };
  const exact = apps.find((a) => norm(a) === q);
  if (exact) return { name: exact, candidates: [exact] };
  const alias = ALIASES[q];
  if (alias && apps.includes(alias)) return { name: alias, candidates: [alias] };
  const starts = apps.filter((a) => norm(a).startsWith(q));
  const contains = apps.filter((a) => norm(a).includes(q));
  const pool = starts.length ? starts : contains;
  if (pool.length) {
    const best = [...pool].sort((a, b) => a.length - b.length)[0];
    return { name: pool.length === 1 || norm(best) === q ? best : best, candidates: pool.slice(0, 5) };
  }
  return { candidates: [] };
}

/** Display names of running apps the user can see in the Dock (no special permission needed). */
export async function runningApps(): Promise<string[]> {
  const r = await run("/usr/bin/lsappinfo", ["list"]);
  if (!r.ok) return [];
  const names = new Set<string>();
  for (const block of r.stdout.split(/^\s*\d+\)\s+/m).slice(1)) {
    const name = block.match(/^"([^"]+)"\s+ASN:/)?.[1];
    if (name && /type="Foreground"/.test(block)) names.add(name);
  }
  return [...names];
}

async function isRunning(name: string): Promise<boolean> {
  const n = norm(name);
  return (await runningApps()).some((a) => norm(a) === n);
}

async function openApp(name: string): Promise<CommandOutcome> {
  const { name: app, candidates } = resolveApp(name);
  if (!app) {
    return {
      ok: false, summary: `No app matching “${name}” is installed`, error: "not_found",
      suggestion: "Call device_list_apps to see installed apps, then retry with the exact name.",
      data: { query: name },
    };
  }
  const wasRunning = await isRunning(app);
  const r = await run("/usr/bin/open", ["-a", app]);
  if (!r.ok) return { ok: false, summary: `Couldn't open ${app}`, error: "upstream_error", suggestion: r.stderr.slice(0, 200) };
  let running = false;
  for (let i = 0; i < 12 && !running; i++) {
    await sleep(350);
    running = await isRunning(app);
  }
  return running
    ? { ok: true, summary: wasRunning ? `${app} brought to the front` : `${app} opened`, data: { app, wasRunning, alternatives: candidates.filter((c) => c !== app) }, verified: true, evidence: `${app} is in the running-apps list` }
    : { ok: false, summary: `${app} did not start`, error: "upstream_error", suggestion: "The app may have crashed on launch or needs a first-run permission.", verified: false };
}

async function quitApp(name: string): Promise<CommandOutcome> {
  const { name: app } = resolveApp(name);
  if (!app) return { ok: false, summary: `No app matching “${name}”`, error: "not_found" };
  if (!(await isRunning(app))) return { ok: true, summary: `${app} wasn't running`, verified: true, evidence: "Not in the running-apps list" };
  const r = await run("/usr/bin/osascript", ["-e", "on run argv", "-e", "tell application (item 1 of argv) to quit", "-e", "end run", app]);
  if (!r.ok && /not authorized|-1743/i.test(r.stderr)) {
    return { ok: false, summary: `macOS blocked Jarvis from quitting ${app}`, error: "permission_denied", suggestion: "Allow automation in System Settings → Privacy & Security → Automation." };
  }
  let stillRunning = true;
  for (let i = 0; i < 10 && stillRunning; i++) {
    await sleep(400);
    stillRunning = await isRunning(app);
  }
  return stillRunning
    ? { ok: false, summary: `${app} is still running (it may be asking to save work)`, error: "conflict", verified: false }
    : { ok: true, summary: `${app} quit`, verified: true, evidence: `${app} no longer in the running-apps list` };
}

// ───────────── Chrome ─────────────

function normalizeUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

interface Tab {
  window: number;
  tab: number;
  title: string;
  url: string;
  active: boolean;
}

// Note: inside `tell application "Google Chrome"` the word `tab` means a Chrome tab, so use ASCII 9 for the separator.
const TABS_SCRIPT = `
set sep to ASCII character 9
tell application "Google Chrome"
  set out to ""
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set ai to active tab index of w
    set ti to 0
    repeat with t in tabs of w
      set ti to ti + 1
      set out to out & wi & sep & ti & sep & (ai = ti) & sep & (title of t) & sep & (URL of t) & linefeed
    end repeat
  end repeat
  return out
end tell`;

async function chromeTabs(): Promise<{ ok: true; tabs: Tab[] } | { ok: false; error: string; permission: boolean }> {
  if (!(await isRunning("Google Chrome"))) return { ok: true, tabs: [] };
  const r = await run("/usr/bin/osascript", ["-e", TABS_SCRIPT], 20_000);
  if (!r.ok) return { ok: false, error: r.stderr, permission: /not authorized|-1743|not allowed/i.test(r.stderr) };
  // A stray newline inside a page title splits a record; keep only well-formed lines.
  const tabs: Tab[] = r.stdout.split("\n").filter((l) => /^\d+\t\d+\t(true|false)\t/.test(l)).map((line) => {
    const [w, t, a, title = "", ...url] = line.split("\t");
    return { window: Number(w), tab: Number(t), active: a === "true", title, url: url.join("\t") };
  });
  return { ok: true, tabs };
}

const PERMISSION_HINT =
  "macOS needs permission: System Settings → Privacy & Security → Automation → allow the app running Jarvis (Terminal / Claude / node) to control Google Chrome.";

async function openUrls(urls: string[], newWindow: boolean): Promise<CommandOutcome> {
  const clean = urls.map(normalizeUrl);
  const bad = urls.filter((_, i) => !clean[i]);
  const good = clean.filter((u): u is string => Boolean(u));
  if (!good.length) return { ok: false, summary: "No valid web address to open", error: "invalid_input", suggestion: "Only http(s) links are allowed.", data: { rejected: bad } };

  const before = await chromeTabs();
  const args = ["-a", "Google Chrome", ...(newWindow ? ["--new", "--args", "--new-window"] : []), ...good];
  const r = await run("/usr/bin/open", args);
  if (!r.ok) {
    return { ok: false, summary: "Couldn't open Chrome", error: "upstream_error", suggestion: /Unable to find/i.test(r.stderr) ? "Google Chrome isn't installed; use device_open_app with another browser." : r.stderr.slice(0, 200) };
  }

  // Verify: the new tabs show up in Chrome (needs Automation permission; degrade gracefully).
  await sleep(1200);
  const after = await chromeTabs();
  if (!after.ok) {
    return { ok: true, summary: `Opened ${good.length} tab${good.length > 1 ? "s" : ""} in Chrome`, data: { urls: good, rejected: bad, tabCheck: "unavailable" }, evidence: "Chrome accepted the open request (tab list unavailable: automation permission not granted)", suggestion: after.permission ? PERMISSION_HINT : undefined };
  }
  const seen = new Set(after.tabs.map((t) => t.url.replace(/\/$/, "")));
  const found = good.filter((u) => {
    const stripped = u.replace(/\/$/, "");
    return seen.has(stripped) || [...seen].some((s) => s.startsWith(stripped) || stripped.startsWith(s.split("#")[0].split("?")[0]) && s.length > 12);
  });
  const prior = before.ok ? before.tabs.length : 0;
  const verified = found.length === good.length || after.tabs.length > prior;
  return {
    ok: true,
    summary: `Opened ${good.length} tab${good.length > 1 ? "s" : ""} in Chrome`,
    data: { urls: good, rejected: bad, tabsNow: after.tabs.length },
    verified,
    evidence: verified ? `Chrome now has ${after.tabs.length} tabs; ${found.length}/${good.length} URLs confirmed` : "The new tabs were not found in Chrome's tab list",
  };
}

async function focusOrCloseTab(kind: "focus" | "close", windowIdx: number, tabIdx: number): Promise<CommandOutcome> {
  const tabs = await chromeTabs();
  if (!tabs.ok) return { ok: false, summary: "Couldn't read Chrome's tabs", error: tabs.permission ? "permission_denied" : "upstream_error", suggestion: tabs.permission ? PERMISSION_HINT : tabs.error.slice(0, 200) };
  const target = tabs.tabs.find((t) => t.window === windowIdx && t.tab === tabIdx);
  if (!target) return { ok: false, summary: "That tab no longer exists", error: "not_found", suggestion: "Call device_chrome_tabs for fresh window/tab numbers." };
  const script = kind === "focus"
    ? `tell application "Google Chrome"\nset index of window ${windowIdx} to 1\nset active tab index of window 1 to ${tabIdx}\nactivate\nend tell`
    : `tell application "Google Chrome" to close tab ${tabIdx} of window ${windowIdx}`;
  const r = await run("/usr/bin/osascript", ["-e", script]);
  if (!r.ok) return { ok: false, summary: `Couldn't ${kind} the tab`, error: "upstream_error", suggestion: r.stderr.slice(0, 200) };
  if (kind === "focus") return { ok: true, summary: `Switched to “${target.title.slice(0, 50)}”`, data: { title: target.title, url: target.url }, verified: true, evidence: "Chrome accepted the tab switch" };
  await sleep(500);
  const after = await chromeTabs();
  const gone = after.ok && !after.tabs.some((t) => t.url === target.url && t.title === target.title && t.window === windowIdx && t.tab === tabIdx);
  return { ok: true, summary: `Closed “${target.title.slice(0, 50)}”`, verified: gone, evidence: gone ? "Tab no longer in Chrome's list" : "Tab still listed" };
}

// ───────────── files ─────────────

async function openPath(p: string): Promise<CommandOutcome> {
  const full = p.startsWith("~") ? path.join(homedir(), p.slice(1)) : p;
  if (!path.isAbsolute(full)) return { ok: false, summary: "Need an absolute path", error: "invalid_input", suggestion: "Use paths like ~/Downloads or /Users/…" };
  if (!existsSync(full)) return { ok: false, summary: `${p} doesn't exist`, error: "not_found" };
  const r = await run("/usr/bin/open", [full]);
  return r.ok
    ? { ok: true, summary: `Opened ${path.basename(full) || full}`, data: { path: full }, evidence: "macOS accepted the open request" }
    : { ok: false, summary: `Couldn't open ${p}`, error: "upstream_error", suggestion: r.stderr.slice(0, 200) };
}

// ───────────── dispatcher ─────────────

export async function executeCommand(type: string, payload: Record<string, unknown>): Promise<CommandOutcome> {
  if (process.platform !== "darwin") return { ok: false, summary: "Device actions only work on macOS", error: "upstream_error" };
  try {
    switch (type as CommandType) {
      case "open_url":
        return await openUrls(Array.isArray(payload.urls) ? payload.urls.map(String) : [], payload.newWindow === true);
      case "open_app":
        return await openApp(String(payload.name ?? ""));
      case "quit_app":
        return await quitApp(String(payload.name ?? ""));
      case "list_apps": {
        const q = norm(String(payload.query ?? ""));
        const apps = installedApps().filter((a) => !q || norm(a).includes(q));
        return { ok: true, summary: `${apps.length} installed app${apps.length === 1 ? "" : "s"}`, data: { apps: apps.slice(0, 150) } };
      }
      case "running_apps": {
        const apps = await runningApps();
        return { ok: true, summary: `${apps.length} apps running`, data: { apps } };
      }
      case "chrome_tabs": {
        const t = await chromeTabs();
        if (!t.ok) return { ok: false, summary: "Couldn't read Chrome's tabs", error: t.permission ? "permission_denied" : "upstream_error", suggestion: t.permission ? PERMISSION_HINT : t.error.slice(0, 200) };
        return { ok: true, summary: t.tabs.length ? `${t.tabs.length} Chrome tabs open` : "Chrome has no open tabs", data: { tabs: t.tabs.slice(0, 80) } };
      }
      case "focus_tab":
        return await focusOrCloseTab("focus", Number(payload.window), Number(payload.tab));
      case "close_tab":
        return await focusOrCloseTab("close", Number(payload.window), Number(payload.tab));
      case "open_path":
        return await openPath(String(payload.path ?? ""));
      default:
        return { ok: false, summary: `Unknown device command “${type}”`, error: "invalid_input" };
    }
  } catch (e) {
    return { ok: false, summary: "Device command crashed", error: "upstream_error", suggestion: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}
