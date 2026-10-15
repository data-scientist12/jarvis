# Jarvis web: build contracts (read this before writing any code)

Three workstreams build in parallel. **Only edit files you own.** If you need something from another stream, code against the contract below, and stub locally if the file doesn't exist yet.

## Ground rules (all agents)
- This is **Next.js 16** (`proxy.ts` replaces middleware), **React 19**, **AI SDK v7** (`ai@7`, `@ai-sdk/openai@4`, `@ai-sdk/react@4`), **Better Auth 1.7**, **Drizzle + Postgres**, **Tailwind v4**, **zod v4**, `motion` (import from `motion/react`).
  APIs differ from older versions you may remember. **Read the bundled docs before using an API:**
  - Next: `node_modules/next/dist/docs/` (see `AGENTS.md`)
  - AI SDK: `node_modules/ai/docs/` (agents, tools, `04-ai-sdk-ui/*`, `07-reference/*`) and the `.d.ts` files
  - Better Auth: `node_modules/better-auth/dist/**/*.d.mts`
- Validate with `npx tsc --noEmit` and `npx eslint <your files>`. **Do NOT run `next dev`, `next build`, `drizzle-kit`, or any git command.** The orchestrator runs the app.
- Env vars live in `.env.local` (already filled in). Read them only on the server. Never add `NEXT_PUBLIC_` secrets.
- Path alias `@/` = `web/`.
- Existing foundation (owned by the orchestrator, don't modify, ask in your final report if a change is needed):
  `lib/db/{index,schema}.ts`, `lib/auth/{index,client,session,scopes}.ts`, `lib/google/client.ts`, `lib/tools/types.ts`, `proxy.ts`, `app/api/auth/[...all]/route.ts`, `drizzle.config.ts`, `.env.local`.

## Ownership
| Stream | Owns |
|---|---|
| **A: Connectors** | `lib/tools/google/**` |
| **B: Engine & API** | `lib/agent/**`, `lib/tools/core/**`, `lib/automations/**`, `lib/security/**`, `app/api/**` (except auth), `instrumentation.ts` |
| **C: UI** | `app/**` pages/layouts (not `app/api`), `app/globals.css`, `components/**`, `hooks/**`, `public/**` |

## Tool contract: `lib/tools/types.ts`
Every tool is a `JarvisTool` (`defineTool({...})`) with `name`, `description`, zod `inputSchema`, `risk` (`read|write|high`), `connector`, `title(input)`, and `execute(input, ctx) → ToolResult`.
`ToolResult = { ok, summary, data?, error?, suggestion?, verified?, evidence?, card? }`. `card` is one of the `Card` union types the UI renders.
- Stream A exports `export const googleTools: JarvisTool[]` from `lib/tools/google/index.ts`.
- Stream B exports `export const coreTools: JarvisTool[]` from `lib/tools/core/index.ts`.
- Tool names are snake_case, prefixed by connector: `gmail_*`, `calendar_*`, `meet_*`, `drive_*`, `docs_*`, `sheets_*`, `tasks_*`, `contacts_*`, `memory_*`. The UI picks icons by prefix. `web_search` is the OpenAI provider tool.
- Tools **never throw for expected failures**. They return `fail(...)` with an error code. Unexpected exceptions are caught by the engine wrapper.
- Error codes the UI and engine understand: `google_not_connected`, `scope_missing`, `contact_not_found`, `not_found`, `invalid_input`, `conflict`, `rate_limited`, `upstream_error`.

## Chat streaming contract (B ↔ C)
- `POST /api/chat`. The client uses `useChat` with `new DefaultChatTransport({ api: '/api/chat', body: () => ({ timezone }) })` and `id = conversationId` (client-generated, e.g. `crypto.randomUUID()`).
  The server receives `{ id, messages, timezone, ... }`, upserts the `conversation` row, streams, and persists `messages` on finish.
- The response is an AI SDK UI message stream. Assistant message parts:
  - `text` parts (markdown)
  - `tool-<toolName>` parts with `state` (`input-streaming` | `input-available` | `approval-requested` | `approval-responded` | `output-available` | `output-error` | `output-denied`). `output` is a **`ToolResult`**
  - `source-url` parts from `web_search`
  - custom data parts:
    - `data-run`: `{ runId: string, status: "running" | "succeeded" | "partial" | "failed" | "needs_input" }`, sent at start and updated at end
    - `data-review`: `{ status: "succeeded" | "partial" | "failed" | "needs_input", summary: string, missing: string[] }`, the reviewer's verdict at the end
- **Approval:** tools with `risk: "high"` use AI SDK tool approval (`needsApproval`) when the user's `profile.autopilot` is false. The UI shows Approve/Deny for `approval-requested` parts and calls `addToolApprovalResponse` (check the v7 docs `03-agents/06-tool-approvals.mdx` / `04-ai-sdk-ui/03-chatbot-tool-usage.mdx` for exact names), with `sendAutomaticallyWhen` set appropriately.

## REST API (B implements, C consumes). All JSON, all require a session (401 otherwise)
| Method & path | Response |
|---|---|
| `GET /api/conversations` | `{ conversations: { id, title, updatedAt }[] }` (latest 30) |
| `GET /api/conversations/:id` | `{ id, title, messages: UIMessage[] }` or 404 |
| `DELETE /api/conversations/:id` | `{ ok: true }` |
| `GET /api/brief` | `{ greeting, summary, connected: boolean, events: {id,title,start,end,meetLink?,htmlLink?}[], emails: {id,threadId,from,subject,snippet,date,unread}[], tasks: {id,title,due?}[], generatedAt }`, cached ~10 min per user, `?refresh=1` to bypass |
| `GET /api/stats` | `{ tasksCompletedToday, tasksCompletedWeek, actionsVerifiedWeek, minutesSavedWeek, automationsActive }` |
| `GET /api/connectors` | `{ googleConfigured: boolean, googleConnected: boolean, googleEmail?: string, connectors: { id, name, description, granted: boolean }[] }` |
| `GET /api/settings` / `PATCH /api/settings` | `{ timezone, autopilot, model }` (model ∈ `gpt-5.4-mini`, `gpt-5.5`) |
| `GET /api/automations` | `{ automations: Automation[] }` where `Automation = { id, name, trigger, instructions, enabled, lastRunAt, nextRunAt, lastStatus, createdAt }` |
| `GET /api/automations/recipes` | `{ recipes: { id, name, description, icon, prompt, connectors: string[] }[] }` |
| `POST /api/automations` | body `{ prompt: string }` (plain English) → `{ automation }` (spec parsed by the model) |
| `PATCH /api/automations/:id` | body `{ enabled?, name?, instructions?, trigger? }` → `{ automation }` |
| `DELETE /api/automations/:id` | `{ ok: true }` |
| `POST /api/automations/:id/run` | `{ runId }` (runs in the background; poll `/api/runs/:id`) |
| `GET /api/runs?limit=50&source=` | `{ runs: { id, source, goal, status, startedAt, finishedAt, stepCount, verifiedCount, review }[] }` |
| `GET /api/runs/:id` | `{ run: {...}, steps: { id, tool, title, status, verified, evidence, input, output, durationMs, createdAt }[] }` |
| `POST /api/transcribe` | multipart `audio` (webm/mp4) → `{ text }` |
| `POST /api/speak` | `{ text }` → `audio/mpeg` stream |
| `POST /api/cron/tick` | header `Authorization: Bearer $CRON_SECRET` → runs due automations (public route, secret-protected) |

Rate limits (B): chat 20/min and 300/day per user, transcribe 30/min, automations create 20/day. Exceeding returns 429 `{ error: "rate_limited", retryAfter }`.

## Auth (foundation is done; C builds the screens)
- Client: `import { signIn, signUp, signOut, useSession, linkSocial, authClient } from "@/lib/auth/client"`.
  - Google: `signIn.social({ provider: "google", callbackURL: "/dashboard" })`
  - Email: `signIn.email({ email, password, callbackURL: "/dashboard" })`, `signUp.email({ name, email, password, callbackURL: "/dashboard" })`
  - Link Google to an email account / re-grant scopes: `linkSocial({ provider: "google", callbackURL: "/connectors" })`
- Server: `getSession()`, `requireSession()` (pages), `requireApiSession()` (API) from `@/lib/auth/session`.
- If `GET /api/connectors` says `googleConfigured: false`, hide or disable Google buttons with the hint "Google sign-in isn't configured yet".

## Models (B)
- Executor (tool loop): `process.env.OPENAI_MODEL` (default `gpt-5.4-mini`), or the user's `profile.model`. Use `reasoningEffort: "low"`.
- Reviewer / orchestrator: `process.env.OPENAI_MODEL_REVIEW` (`gpt-5.5`). It checks the goal against verified steps → `data-review`, and it also parses automation specs and writes the brief summary.
- Transcribe: `gpt-4o-mini-transcribe`. Speech: `gpt-4o-mini-tts`.
