import { z } from "zod";
import { runOnDevice } from "@/lib/device/queue";
import type { CommandOutcome } from "@/lib/device/executor";
import { defineTool, type JarvisTool, type ToolResult } from "@/lib/tools/types";

/** Converts an executor outcome into a ToolResult (cards added by each tool). */
function toResult(o: CommandOutcome, card?: ToolResult["card"]): ToolResult {
  return {
    ok: o.ok,
    summary: o.summary,
    data: o.data,
    error: o.error,
    suggestion: o.suggestion,
    verified: o.ok ? o.verified : false,
    evidence: o.evidence,
    card: o.ok ? card : undefined,
  };
}

const host = (u: string) => {
  try { return new URL(/^[a-z]+:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return u; }
};

const openUrl = defineTool({
  name: "device_open_url",
  description:
    "Open one or more web pages as NEW TABS in the user's Google Chrome on their Mac (their signed-in browser). Use for 'open X in Chrome', 'open my Gmail/Calendar/YouTube', 'search Google for …' (pass https://www.google.com/search?q=…), or setting up a workspace of several tabs at once. Bare domains are fine.",
  inputSchema: z.object({
    urls: z.array(z.string().min(3).max(2000)).min(1).max(10).describe("Web addresses to open, one tab each."),
    newWindow: z.boolean().default(false).describe("Open in a fresh Chrome window instead of the current one."),
  }),
  risk: "write",
  connector: "core",
  title: ({ urls }) => (urls.length === 1 ? `Opening ${host(urls[0])} in Chrome` : `Opening ${urls.length} tabs in Chrome`),
  async execute(input, ctx) {
    const o = await runOnDevice(ctx.userId, "open_url", input);
    const urls = (o.data?.urls as string[] | undefined) ?? input.urls;
    return toResult(o, { type: "bulk", action: o.summary, count: urls.length, items: urls.map((u) => u.replace(/^https?:\/\//, "")) });
  },
});

const chromeTabs = defineTool({
  name: "device_chrome_tabs",
  description: "List every open Chrome tab on the user's Mac (window number, tab number, title, URL). Use to find a tab, to check what's open, or before focusing/closing one.",
  inputSchema: z.object({}),
  risk: "read",
  connector: "core",
  title: () => "Checking your Chrome tabs",
  async execute(_i, ctx) {
    const o = await runOnDevice(ctx.userId, "chrome_tabs", {});
    const tabs = (o.data?.tabs as { window: number; tab: number; title: string; url: string }[] | undefined) ?? [];
    return toResult(o, tabs.length ? { type: "note", title: `${tabs.length} Chrome tabs`, text: tabs.slice(0, 25).map((t) => `${t.title || t.url} — ${host(t.url)}`).join("\n") } : undefined);
  },
});

const focusTab = defineTool({
  name: "device_focus_tab",
  description: "Bring a specific Chrome tab to the front. Get window/tab numbers from device_chrome_tabs.",
  inputSchema: z.object({ window: z.number().int().min(1), tab: z.number().int().min(1) }),
  risk: "write",
  connector: "core",
  title: () => "Switching Chrome tab",
  execute: async (input, ctx) => toResult(await runOnDevice(ctx.userId, "focus_tab", input)),
});

const closeTab = defineTool({
  name: "device_close_tab",
  description: "Close a specific Chrome tab. Get window/tab numbers from device_chrome_tabs. Closing several? Re-list tabs between closes because numbers shift.",
  inputSchema: z.object({ window: z.number().int().min(1), tab: z.number().int().min(1) }),
  risk: "high",
  connector: "core",
  title: () => "Closing a Chrome tab",
  execute: async (input, ctx) => toResult(await runOnDevice(ctx.userId, "close_tab", input)),
});

const openApp = defineTool({
  name: "device_open_app",
  description:
    "Launch an application on the user's Mac, or bring it to the front if it's already running (Spotify, WhatsApp, Notes, Calculator, System Settings, Terminal, Finder…). Natural names and nicknames work ('chrome', 'settings'). If the name isn't found, call device_list_apps.",
  inputSchema: z.object({ name: z.string().min(1).max(100).describe("App name, e.g. 'Spotify' or 'System Settings'.") }),
  risk: "write",
  connector: "core",
  title: ({ name }) => `Opening ${name}`,
  async execute(input, ctx) {
    const o = await runOnDevice(ctx.userId, "open_app", input);
    const app = (o.data?.app as string | undefined) ?? input.name;
    return toResult(o, { type: "note", title: o.summary, text: `${app} is running on your Mac.` });
  },
});

const quitApp = defineTool({
  name: "device_quit_app",
  description: "Quit a running application on the user's Mac (it may ask to save unsaved work).",
  inputSchema: z.object({ name: z.string().min(1).max(100) }),
  risk: "high",
  connector: "core",
  title: ({ name }) => `Quitting ${name}`,
  execute: async (input, ctx) => toResult(await runOnDevice(ctx.userId, "quit_app", input)),
});

const runningApps = defineTool({
  name: "device_running_apps",
  description: "List the apps currently running on the user's Mac.",
  inputSchema: z.object({}),
  risk: "read",
  connector: "core",
  title: () => "Checking running apps",
  execute: async (_i, ctx) => toResult(await runOnDevice(ctx.userId, "running_apps", {})),
});

const listApps = defineTool({
  name: "device_list_apps",
  description: "List apps installed on the user's Mac, optionally filtered by a name fragment. Use when device_open_app can't find an app.",
  inputSchema: z.object({ query: z.string().max(60).optional() }),
  risk: "read",
  connector: "core",
  title: ({ query }) => (query ? `Looking for “${query}” among your apps` : "Listing installed apps"),
  execute: async (input, ctx) => toResult(await runOnDevice(ctx.userId, "list_apps", input)),
});

const openPath = defineTool({
  name: "device_open_path",
  description: "Open a file or folder on the user's Mac in its default app / Finder (e.g. ~/Downloads, ~/Desktop/report.pdf).",
  inputSchema: z.object({ path: z.string().min(1).max(500).describe("Absolute path or one starting with ~") }),
  risk: "write",
  connector: "core",
  title: ({ path }) => `Opening ${path.split("/").filter(Boolean).pop() ?? path}`,
  execute: async (input, ctx) => toResult(await runOnDevice(ctx.userId, "open_path", input)),
});

export const deviceTools: JarvisTool[] = [openUrl, chromeTabs, focusTab, closeTab, openApp, quitApp, runningApps, listApps, openPath];
