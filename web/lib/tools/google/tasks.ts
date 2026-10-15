import { z } from "zod";
import type { tasks_v1 } from "googleapis";
import { defineTool, fail, ok, type JarvisTool, type ToolResult } from "@/lib/tools/types";
import { InputError, guard, localDateOf, mapLimit, short, tasksClient } from "./util";

type Task = tasks_v1.Schema$Task;

const dueOf = (t: Task) => t.due?.slice(0, 10);
const view = (t: Task) => ({ id: t.id ?? "", title: t.title ?? "", due: dueOf(t), status: t.status ?? "needsAction", notes: t.notes ?? undefined });

/** Tasks API stores only a date: send midnight UTC of the user's local date. */
function dueToRfc3339(due: string | undefined, tz: string): string | undefined {
  if (!due) return undefined;
  return `${localDateOf(due, tz)}T00:00:00.000Z`;
}

const dueDesc = "Due date, e.g. 2026-10-20 (only the date is stored; times are ignored).";

const tasksList = defineTool({
  name: "tasks_list",
  description: "List the user's Google Tasks (open by default). Use for 'what's on my to-do list' or before completing a task. Optionally filter by due date.",
  risk: "read",
  connector: "tasks",
  inputSchema: z.object({
    tasklistId: z.string().default("@default").describe("Task list id (default: the main list)."),
    showCompleted: z.boolean().default(false).describe("Include completed tasks."),
    dueMax: z.string().optional().describe("Only tasks due on or before this date (YYYY-MM-DD)."),
  }),
  title: () => "Checking your tasks",
  execute: (input, ctx) =>
    guard("tasks", async () => {
      const tasks = await tasksClient(ctx);
      const r = await tasks.tasks.list({
        tasklist: input.tasklistId,
        showCompleted: input.showCompleted,
        showHidden: input.showCompleted,
        maxResults: 100,
        dueMax: input.dueMax ? `${localDateOf(input.dueMax, ctx.timezone)}T23:59:59.000Z` : undefined,
      });
      const items = (r.data.items ?? []).filter((t) => t.title).map(view);
      return ok(items.length ? `${items.length} task${items.length === 1 ? "" : "s"}${input.showCompleted ? "" : " open"}` : "No matching tasks", {
        data: { count: items.length, tasks: items },
        card: { type: "task_list", tasks: items.map((t) => ({ id: t.id, title: t.title, due: t.due, status: t.status })) },
      });
    }),
});

async function insertVerified(tasks: tasks_v1.Tasks, tasklist: string, body: Task): Promise<Task | null> {
  const c = await tasks.tasks.insert({ tasklist, requestBody: body });
  if (!c.data.id) return null;
  const g = await tasks.tasks.get({ tasklist, task: c.data.id });
  return g.data.title === body.title ? g.data : null;
}

const tasksCreate = defineTool({
  name: "tasks_create",
  description: "Create a to-do in Google Tasks (syncs to the user's phone). Use for reminders and action items ('remind me to…', 'add a task').",
  risk: "write",
  connector: "tasks",
  inputSchema: z.object({
    title: z.string().min(1).describe("Task title."),
    notes: z.string().optional().describe("Extra details."),
    due: z.string().optional().describe(dueDesc),
    tasklistId: z.string().default("@default").describe("Task list id (default: main list)."),
  }),
  title: (i) => `Adding task “${short(i.title, 40)}”`,
  execute: (input, ctx) =>
    guard("tasks", async () => {
      const tasks = await tasksClient(ctx);
      const body: Task = { title: input.title, notes: input.notes, due: dueToRfc3339(input.due, ctx.timezone) };
      const got = await insertVerified(tasks, input.tasklistId, body);
      if (!got) return fail("The task could not be confirmed after creating it.", "upstream_error", "Run tasks_list before retrying to avoid duplicates.");
      return {
        ok: true,
        summary: `Task “${input.title}” added${dueOf(got) ? ` (due ${dueOf(got)})` : ""}`,
        data: view(got),
        verified: true,
        evidence: `Tasks API returned task ${got.id} with matching title`,
        card: { type: "task", title: input.title, due: dueOf(got), list: input.tasklistId === "@default" ? "My Tasks" : input.tasklistId, status: "created" },
      } satisfies ToolResult;
    }),
});

const tasksCreateMany = defineTool({
  name: "tasks_create_many",
  description: "Create many to-dos at once (up to 50), e.g. action items extracted from emails or meeting notes. Prefer this over repeated tasks_create calls.",
  risk: "write",
  connector: "tasks",
  inputSchema: z.object({
    items: z
      .array(z.object({ title: z.string().min(1).describe("Task title."), notes: z.string().optional().describe("Details."), due: z.string().optional().describe(dueDesc) }))
      .min(1)
      .max(50)
      .describe("Tasks to create."),
    tasklistId: z.string().default("@default").describe("Task list id (default: main list)."),
  }),
  title: (i) => `Adding ${i.items.length} tasks`,
  execute: (input, ctx) =>
    guard("tasks", async () => {
      const tasks = await tasksClient(ctx);
      const due = input.items.map((i) => dueToRfc3339(i.due, ctx.timezone)); // validate all dates before creating anything
      const created: Task[] = [];
      const failedTitles: string[] = [];
      for (const [idx, item] of input.items.entries()) {
        try {
          const c = await tasks.tasks.insert({ tasklist: input.tasklistId, requestBody: { title: item.title, notes: item.notes, due: due[idx] } });
          if (c.data.id) created.push(c.data);
          else failedTitles.push(item.title);
        } catch (err) {
          const st = (err as { response?: { status?: number } })?.response?.status;
          if (st === 401 || st === 403) throw err;
          failedTitles.push(item.title);
        }
      }
      const checks = await mapLimit(created, 5, async (t) => {
        try {
          const g = await tasks.tasks.get({ tasklist: input.tasklistId, task: t.id as string });
          return g.data.id === t.id ? g.data : null;
        } catch {
          return null;
        }
      });
      const confirmed = checks.filter((t): t is Task => t !== null);
      const allOk = failedTitles.length === 0 && confirmed.length === input.items.length;
      return {
        ok: allOk,
        summary: `Created ${confirmed.length} of ${input.items.length} tasks`,
        data: { created: confirmed.map(view), failed: failedTitles },
        verified: allOk,
        evidence: `Re-read ${confirmed.length}/${created.length} created tasks from Google Tasks`,
        error: allOk ? undefined : "upstream_error",
        suggestion: allOk ? undefined : `Retry only these: ${failedTitles.join("; ") || "(unconfirmed items)"}`,
        card: { type: "task_list", tasks: confirmed.map((t) => ({ id: t.id ?? "", title: t.title ?? "", due: dueOf(t), status: t.status ?? "needsAction" })) },
      } satisfies ToolResult;
    }),
});

const tasksComplete = defineTool({
  name: "tasks_complete",
  description: "Mark a task as done. Give the taskId (from tasks_list) or a title fragment to match an open task.",
  risk: "write",
  connector: "tasks",
  inputSchema: z.object({
    taskId: z.string().optional().describe("Task id from tasks_list."),
    title: z.string().optional().describe("Case-insensitive part of the task title (used when taskId is not given)."),
    tasklistId: z.string().default("@default").describe("Task list id (default: main list)."),
  }),
  title: (i) => `Completing task${i.title ? ` “${short(i.title, 40)}”` : ""}`,
  execute: (input, ctx) =>
    guard("tasks", async () => {
      if (!input.taskId && !input.title?.trim()) throw new InputError("Provide taskId or title.");
      const tasks = await tasksClient(ctx);
      let id = input.taskId;
      let name = "";
      if (!id) {
        const needle = (input.title as string).trim().toLowerCase();
        const r = await tasks.tasks.list({ tasklist: input.tasklistId, showCompleted: false, maxResults: 100 });
        const open = (r.data.items ?? []).filter((t) => t.title);
        const exact = open.filter((t) => t.title?.toLowerCase() === needle);
        const matches = exact.length ? exact : open.filter((t) => t.title?.toLowerCase().includes(needle));
        if (!matches.length) return fail(`No open task matches “${input.title}”.`, "not_found", "Call tasks_list to see open tasks.");
        if (matches.length > 1) return fail(`${matches.length} tasks match “${input.title}”.`, "invalid_input", "Ask the user which one, then pass taskId.", { candidates: matches.map(view) });
        id = matches[0].id as string;
        name = matches[0].title ?? "";
      }
      await tasks.tasks.patch({ tasklist: input.tasklistId, task: id, requestBody: { status: "completed" } });
      const got = await tasks.tasks.get({ tasklist: input.tasklistId, task: id });
      const verified = got.data.status === "completed";
      name = got.data.title ?? name;
      return {
        ok: verified,
        summary: `Task “${name}” marked done`,
        data: view(got.data),
        verified,
        evidence: `Task ${id} status is now ${got.data.status}`,
        error: verified ? undefined : "upstream_error",
        card: { type: "task", title: name, due: dueOf(got.data), status: "completed" },
      } satisfies ToolResult;
    }),
});

const tasksListTasklists = defineTool({
  name: "tasks_list_tasklists",
  description: "List the user's Google Tasks lists (id and title). Use when the user refers to a specific list by name.",
  risk: "read",
  connector: "tasks",
  inputSchema: z.object({}),
  title: () => "Listing task lists",
  execute: (_input, ctx) =>
    guard("tasks", async () => {
      const tasks = await tasksClient(ctx);
      const r = await tasks.tasklists.list({ maxResults: 100 });
      const lists = (r.data.items ?? []).map((l) => ({ id: l.id ?? "", title: l.title ?? "" }));
      return ok(`${lists.length} task list${lists.length === 1 ? "" : "s"}`, { data: { default: "@default", lists } });
    }),
});

export const tasksTools: JarvisTool[] = [tasksList, tasksCreate, tasksCreateMany, tasksComplete, tasksListTasklists];
