import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { defineTool, fail, ok, type JarvisTool } from "@/lib/tools/types";
import { deviceTools } from "./device";

const MAX_MEMORIES = 200;

const memorySave = defineTool({
  name: "memory_save",
  description:
    "Save a durable fact or preference about the user (e.g. 'Prefers meetings after 11am', 'Manager is Priya Shah <priya@acme.com>'). Use only for stable information the user would want remembered across chats.",
  inputSchema: z.object({ fact: z.string().min(3).max(500).describe("One self-contained fact, written in the third person.") }),
  risk: "write",
  connector: "core",
  title: () => "Saving to memory",
  async execute({ fact }, ctx) {
    const existing = await db.select({ id: schema.memory.id, fact: schema.memory.fact }).from(schema.memory).where(eq(schema.memory.userId, ctx.userId));
    if (existing.length >= MAX_MEMORIES) return fail("Memory is full", "conflict", "Forget some older facts with memory_forget first.");
    const dup = existing.find((m) => m.fact.trim().toLowerCase() === fact.trim().toLowerCase());
    if (dup) return ok("Already remembered", { data: { id: dup.id }, verified: true, evidence: `Memory ${dup.id} exists` });
    const [row] = await db.insert(schema.memory).values({ userId: ctx.userId, fact: fact.trim() }).returning({ id: schema.memory.id });
    const [check] = await db.select({ id: schema.memory.id }).from(schema.memory).where(and(eq(schema.memory.id, row.id), eq(schema.memory.userId, ctx.userId))).limit(1);
    return ok(`Remembered: ${fact.trim().slice(0, 80)}`, {
      data: { id: row.id },
      verified: Boolean(check),
      evidence: check ? `Memory row ${row.id} stored` : "Memory row not found after insert",
      card: { type: "note", title: "Remembered", text: fact.trim() },
    });
  },
});

const memoryList = defineTool({
  name: "memory_list",
  description: "List the facts Jarvis has saved about the user (with ids).",
  inputSchema: z.object({}),
  risk: "read",
  connector: "core",
  title: () => "Reading memory",
  async execute(_input, ctx) {
    const rows = await db.select({ id: schema.memory.id, fact: schema.memory.fact }).from(schema.memory)
      .where(eq(schema.memory.userId, ctx.userId)).orderBy(desc(schema.memory.createdAt)).limit(MAX_MEMORIES);
    return ok(`${rows.length} saved fact${rows.length === 1 ? "" : "s"}`, { data: { facts: rows } });
  },
});

const memoryForget = defineTool({
  name: "memory_forget",
  description: "Delete a saved fact by its id (from memory_list).",
  inputSchema: z.object({ id: z.string().uuid() }),
  risk: "write",
  connector: "core",
  title: () => "Forgetting a fact",
  async execute({ id }, ctx) {
    const deleted = await db.delete(schema.memory).where(and(eq(schema.memory.id, id), eq(schema.memory.userId, ctx.userId))).returning({ id: schema.memory.id });
    if (!deleted.length) return fail("No such memory", "not_found", "Call memory_list to see valid ids.");
    const [still] = await db.select({ id: schema.memory.id }).from(schema.memory).where(eq(schema.memory.id, id)).limit(1);
    return ok("Forgot that fact", { verified: !still, evidence: still ? "Row still present" : `Memory ${id} deleted` });
  },
});

const timeNow = defineTool({
  name: "time_now",
  description: "Get the current date, time and weekday in the user's timezone. Use it for any relative date math (tomorrow, next Friday, in 3 days).",
  inputSchema: z.object({}),
  risk: "read",
  connector: "core",
  title: () => "Checking the time",
  async execute(_input, ctx) {
    const now = new Date();
    const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: ctx.timezone, ...o }).format(now);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: ctx.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: ctx.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
    const weekday = fmt({ weekday: "long" });
    return ok(`${weekday} ${date} ${time} (${ctx.timezone})`, {
      data: { iso: now.toISOString(), date, time, weekday, timezone: ctx.timezone },
    });
  },
});

export const coreTools: JarvisTool[] = [memorySave, memoryList, memoryForget, timeNow, ...deviceTools];
