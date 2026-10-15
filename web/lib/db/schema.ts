import { pgTable, text, timestamp, boolean, integer, jsonb, index, uuid } from "drizzle-orm/pg-core";

// ─── Better Auth core tables (field names must match Better Auth's model) ───

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [index("session_user_idx").on(t.userId)]);

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("account_user_idx").on(t.userId)]);

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Jarvis app tables ───

/** Per-user preferences. */
export const profile = pgTable("profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  timezone: text("timezone").default("Asia/Kolkata").notNull(),
  autopilot: boolean("autopilot").default(false).notNull(),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const conversation = pgTable("conversation", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  title: text("title").default("New chat").notNull(),
  /** Full AI SDK UIMessage[] for the thread. */
  messages: jsonb("messages").$type<unknown[]>().default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("conversation_user_idx").on(t.userId, t.updatedAt)]);

/** One execution of a goal (chat turn, automation, or brief). */
export const run = pgTable("run", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  source: text("source").$type<"chat" | "automation" | "brief">().notNull(),
  conversationId: text("conversation_id"),
  automationId: uuid("automation_id"),
  goal: text("goal").notNull(),
  status: text("status").$type<"running" | "succeeded" | "partial" | "failed" | "needs_input">().default("running").notNull(),
  /** Reviewer verdict: { complete, summary, missing[] } */
  review: jsonb("review").$type<Record<string, unknown>>(),
  finalText: text("final_text"),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("run_user_idx").on(t.userId, t.startedAt)]);

export const runStep = pgTable("run_step", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => run.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id"),
  tool: text("tool").notNull(),
  title: text("title").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  status: text("status").$type<"running" | "verified" | "done" | "failed">().default("running").notNull(),
  verified: boolean("verified"),
  evidence: text("evidence"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("run_step_run_idx").on(t.runId)]);

export const automation = pgTable("automation", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** { type: "schedule", cron, timezone } | { type: "gmail", query, everyMinutes } | { type: "manual" } */
  trigger: jsonb("trigger").$type<Record<string, unknown>>().notNull(),
  instructions: text("instructions").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  /** Trigger bookkeeping, e.g. last seen Gmail message ids. */
  state: jsonb("state").$type<Record<string, unknown>>().default({}).notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastStatus: text("last_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("automation_due_idx").on(t.enabled, t.nextRunAt)]);

export const memory = pgTable("memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("memory_user_idx").on(t.userId)]);

export const usageEvent = pgTable("usage_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("usage_user_idx").on(t.userId, t.createdAt)]);

// ─── Device bridge: lets Jarvis act on the user's own computer ───

/** A paired Mac running the Jarvis companion (used when the app is hosted). */
export const device = pgTable("device", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** sha256 of the pairing token; the token itself is shown once. */
  tokenHash: text("token_hash").notNull().unique(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("device_user_idx").on(t.userId)]);

/** Work queued for a device executor (the dev server's local executor, or a paired companion). */
export const deviceCommand = pgTable("device_command", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  deviceId: uuid("device_id"),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").$type<"pending" | "running" | "done" | "failed" | "expired">().default("pending").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("device_command_pending_idx").on(t.status, t.userId)]);
