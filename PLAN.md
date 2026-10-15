# JARVIS — Hosted Personal AI Agent
### Implementation plan v2 (web, on the hackathon's `.xyz` domain)

> **Pitch:** *"ChatGPT tells you how. Jarvis does it."*
> Sign in with Google, then tell Jarvis what you need, by typing or by voice. It plans the steps, carries them out across Gmail, Calendar, Meet, Drive, Docs, Sheets, Tasks and Contacts, checks that each step really happened, and shows the whole run as a live animated mission. Jarvis can also run tasks on a schedule ("every morning at 8…") while you're away.

---

## 0. What changed from v1, and why

| v1 (native macOS app) | v2 (hosted web app) | Reason |
|---|---|---|
| Swift app on one MacBook | **Next.js app on `<team>.xyz`**, code in a GitHub repo, installable on a phone as a PWA (web app that can be added to the home screen) | The hackathon gives us the domain at hour 4 and requires hosting plus a public repo |
| Key read from a local `.env` | **Key kept only on the server**, behind Google sign-in, rate limits, a spending cap and an email allowlist | A public URL would otherwise let anyone spend our OpenAI credit |
| Gmail/Calendar driven through Chrome UI | **Google APIs with OAuth tokens per user** (Gmail, Calendar, Meet, Drive, Docs, Sheets, Tasks, People) | More reliable, works for every user, and needs no local browser |
| Local computer control (WhatsApp desktop, iMessage) | Optional **Desktop Companion** (the Swift code, now in `desktop/`) that pairs with the hosted app | A website can't control a Mac. The companion is a stretch goal for that |
| Mac-only | Any device: laptop, phone (PWA), tablet | "Works across devices" now comes free |

---

## 1. User journey (the order the wow moments land in)

1. **Landing page (`jarvis.xyz`):** a full-screen 3D orb with HUD rings and the line *"Don't ask how. Ask Jarvis."* The page has one button: **Sign in with Google**.
2. **One Google consent screen** with checkboxes for Gmail, Calendar, Drive, Tasks and Contacts.
3. **Boot sequence (~3 s):** the rings draw in and the connector icons orbit the core, each one locking on with a ✓ as Jarvis checks its token. Then: *"Good morning, Siddharth."*
4. **Daily brief generated automatically:** the next meetings, important unread email, and tasks due, shown as animated cards plus a three-line summary.
5. **Command:** *"Schedule a Meet with Priya tomorrow at 4 about the demo and email her the agenda."*
   **Mission Control** (the live run panel) opens beside the chat. Each step lights up in turn: Contacts → Free/Busy → Calendar + Meet → Gmail. Result cards fly in: an event card with a **Join Meet** button, and an email card whose body types itself out before a **SENT ✓** stamp lands on it.
6. **Automations:** *"Every weekday at 8am email me my brief and add anything urgent to my tasks."* This creates an automation card. Click **Run now** to watch it run.
7. **Phone:** open the same URL on a phone and the brief, runs and chat are all there. Tasks Jarvis created appear in the Google Tasks app, and events in Google Calendar.
8. **Failure:** *"Invite Batman to the standup."* That step turns red and shakes, and Jarvis asks: *"I couldn't find Batman in your contacts. Did you mean Bharat?"*

---

## 2. Architecture

```
                         ┌──────────────────────── Browser / PWA (any device) ────────────────────────┐
                         │  Landing + 3D Orb (R3F)   Chat   Mission Control   Cards   Automations   Voice │
                         └──────────────┬──────────────────────────┬───────────────────────┬──────────┘
                                        │ HTTPS (session cookie)   │ SSE run events         │ WebRTC (phase 2)
                                        ▼                          ▼                        ▼
┌──────────────────────────────────────── Next.js on Vercel (<team>.xyz) ─────────────────────────────────────┐
│ middleware.ts → require session + allowlist        Upstash rate limiter (per user, per route)               │
│                                                                                                             │
│ /api/auth/*  Auth.js v5 + Google (offline access, incremental scopes, encrypted refresh tokens)            │
│ /api/chat    Agent run: AI SDK streamText → OpenAI Responses (gpt-5.4-mini) → tools → verifier → UI stream  │
│ /api/runs/:id/events   SSE replay/live for automation + voice-delegated runs                               │
│ /api/voice/session     mints an EPHEMERAL Realtime client secret (key never leaves the server)             │
│ /api/inngest           durable functions: automations (cron), Gmail watchers, long tasks, retries          │
│                                                                                                             │
│ lib/agent ─ ToolRegistry ─┬─ Gmail ─ Calendar ─ Meet ─ Drive ─ Docs ─ Sheets ─ Tasks ─ People(Contacts)     │
│                            ├─ Web search (OpenAI hosted) ─ Memory ─ Notify (email/web push)                 │
│                            └─ Device tools (only when a Desktop Companion is online)                        │
└──────────────┬──────────────────────────┬──────────────────────────┬──────────────────────────┬────────────┘
               ▼                          ▼                          ▼                          ▼
        Neon Postgres              Upstash Redis               OpenAI API                Google APIs
     (users, tokens, runs,       (rate limits, run            (Responses, Realtime,      (per-user OAuth
      steps, automations)          pub/sub cache)               TTS, image)                 tokens)
```

### Stack decisions
| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | Frontend and API in one repo, first-class on Vercel |
| Hosting | **Vercel**, linked to GitHub. Pushing to `main` deploys to production, and every PR gets a preview URL | Custom `.xyz` domain in 2 minutes. Fluid compute allows `maxDuration = 300` s for agent routes |
| Agent SDK | **Vercel AI SDK** (`ai` + `@ai-sdk/openai`, Responses API) | Streams text and tool-call parts straight into React. Built-in multi-step tool loop and human approval of tool calls. Saves about a day |
| Models (verified on our key) | `gpt-5.4-mini` (default, ~3 s per tool call) · `gpt-5.5` ("deep mode" for complex plans) · `gpt-realtime-2.1-mini` (voice) · `gpt-4o-mini-tts` (spoken brief) · `gpt-image-2` (optional visuals) | Speed first; quality when needed |
| Auth | **Auth.js v5**, Google provider + Drizzle adapter, database sessions | Google sign-in is both the login and the connector grant |
| Database | **Neon Postgres** (Vercel Marketplace) + **Drizzle ORM** | Free tier, serverless, one click |
| Rate limit / cache | **Upstash Redis** (`@upstash/ratelimit`) | Protects the OpenAI key from abuse |
| Background jobs | **Inngest** (cron, events, step retries, run logs) | Automations and long tasks survive serverless timeouts. Fallback: Upstash QStash |
| Google SDK | `googleapis` (Node) | Typed clients for every Google API |
| UI | Tailwind + shadcn/ui + **Framer Motion** + **React Three Fiber/drei** (orb) | Fast to build, and gives the "wow" visuals |
| Voice (phase 2) | OpenAI **Realtime over WebRTC** with ephemeral client secrets | Sub-second speech-to-speech; the key stays on the server |

---

## 3. Security: protecting the key, and authentication

"Some extent of authentication," scaled for a hackathon but done properly:

### 3.1 OpenAI key protection
1. `OPENAI_API_KEY` lives **only** in Vercel's encrypted environment variables. It is never `NEXT_PUBLIC_*`, never sent to the browser, and never committed (`.env*` is gitignored and GitHub push protection is on).
2. **Every** OpenAI call goes through a server route that first runs `auth()` (no session → 401).
3. **Voice:** the browser never sees the key. `/api/voice/session` calls `POST /v1/realtime/client_secrets` and returns a **short-lived ephemeral secret** scoped to one session config (model, voice, tools). WebRTC connects with that.
4. **Per-user rate limits** (Upstash): chat 20 requests/min and 300/day; voice sessions 10/hour; automations 20 per user. Over the limit → a friendly "Jarvis needs a breather" toast and HTTP 429.
5. **Token budget:** log `usage` from every response into `usage_events`. Hard daily cap per user (e.g. 2M tokens) → reply "Daily limit reached."
6. **OpenAI dashboard:** create a dedicated **project key** for Jarvis with a **monthly hard spend limit**, and only Responses/Realtime/Audio/Images permissions. Rotate the key that was pasted locally once it is moved to Vercel.

### 3.2 User authentication (Google sign-in)
- Auth.js v5 Google provider with `access_type=offline`, `prompt=consent`, `include_granted_scopes=true`. This gives a **refresh token**, so Jarvis keeps working for automations while the user is offline.
- **Database sessions** in an HTTP-only, Secure, SameSite=Lax cookie. Auth.js handles CSRF.
- **Allowlist (`ALLOWED_EMAILS` + `invites` table):** only allowlisted emails get in, and everyone else sees a "Request access" page. This matches Google "Testing" mode, which only lets test users sign in anyway.
- **Google refresh and access tokens encrypted at rest** with AES-256-GCM (`TOKEN_ENC_KEY`), by wrapping the adapter's `linkAccount` / `updateAccount`.
- `middleware.ts` protects `/dashboard`, `/automations`, `/runs`, `/connectors`, `/settings` and `/api/*`, except `/api/auth/*`, `/api/inngest` (signature-verified) and public pages.
- **Per-user isolation:** every DB query is scoped by `userId`, and tools build the Google client from the **session's** user only.
- **Risky actions:** sending email, deleting, sharing Drive files publicly and emailing people outside the user's domain show a **confirmation card** unless the user switches on **Autopilot** in Settings (on by default only for the demo account).
- **Audit log:** every tool call (name, args hash, result, verified) goes to `run_steps`, viewable on `/runs/:id`.
- Security headers in `next.config` (CSP, `frame-ancestors 'none'`, `Referrer-Policy`), and Vercel Firewall rate rules on `/api/*`.

### 3.3 Google OAuth realities (plan around these)
- Gmail (`gmail.modify`) and Drive (`drive`) are **restricted scopes**. A production launch would need Google verification, which takes weeks. **For the hackathon the consent screen stays in "Testing"**: up to 100 named test users, and they see a "Google hasn't verified this app" warning once (Continue → Allow). Add every teammate and **each judge's Gmail** as a test user.
- In Testing mode, **refresh tokens expire after 7 days**. That's fine for the event.
- **Granular consent:** users can untick scopes on the consent screen. Read `account.scope` and mark each connector Connected / Not granted, with a **Grant** button that re-runs sign-in for just that scope (incremental authorization).

### 3.4 Scopes (requested on first sign-in)
| Connector | Scope | Class |
|---|---|---|
| Identity | `openid email profile` | — |
| Gmail | `https://www.googleapis.com/auth/gmail.modify` (read, send, draft, label, archive) | Restricted |
| Calendar (+ Meet links) | `https://www.googleapis.com/auth/calendar` | Sensitive |
| Meet (instant rooms) | `https://www.googleapis.com/auth/meetings.space.created` | Sensitive |
| Drive / Docs / Sheets / Slides | `https://www.googleapis.com/auth/drive` | Restricted |
| Tasks | `https://www.googleapis.com/auth/tasks` | Sensitive |
| Contacts | `https://www.googleapis.com/auth/contacts.readonly` + `contacts.other.readonly` | Sensitive |

---

## 4. Google Cloud setup (H0–H1, by one person, in parallel with scaffolding)

1. console.cloud.google.com → New project **"Jarvis"**.
2. **Enable APIs:** Gmail, Google Calendar, Google Meet REST, Google Drive, Google Docs, Google Sheets, Google Tasks, People.
3. **OAuth consent screen** (Google Auth Platform): app name *Jarvis*, support email, logo, **Audience: External, Testing**, add test users (team + judges). Add the scopes from §3.4. Authorized domains: `vercel.app` for now, and **`<team>.xyz` at hour 4**. App home page, privacy (`/privacy`) and terms (`/terms`) links; we ship simple pages for these.
4. **Credentials → OAuth client ID → Web application**:
   - Authorized JavaScript origins: `http://localhost:3000`, `https://jarvis-<team>.vercel.app`, `https://<team>.xyz` (add at H4)
   - Authorized redirect URIs: `…/api/auth/callback/google` for each origin above
5. Copy the Client ID and secret into `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` (local `.env.local` + Vercel).

---

## 5. Connectors: the tools the agent can call

Design rules: **short imperative descriptions**, Zod input schemas, and every tool returns `ToolResult { ok, summary, data, error?, suggestion?, verified?, evidence?, card? }`. `card` tells the UI which animated result card to render.

### Gmail (`lib/tools/gmail.ts`)
| Tool | Google API | Verification |
|---|---|---|
| `gmail_search(query, max)` | `users.messages.list(q)` → batched `messages.get(format=metadata)` | — |
| `gmail_read(id)` | `messages.get(format=full)` → decode text/plain (HTML → text fallback), list attachments | — |
| `gmail_send(to[], subject, body, cc?, attachments?: driveFileIds)` | Build RFC 2822 MIME (Drive files attached as links or as bytes when under 5 MB) → `messages.send` | `messages.get(id)` has the `SENT` label ✓ |
| `gmail_reply(messageId, body, replyAll?)` | Same thread: `threadId` plus `In-Reply-To`/`References` headers | `SENT` label + same `threadId` ✓ |
| `gmail_draft(...)` | `drafts.create` | `drafts.get` ✓ |
| `gmail_triage(action, ids[] or query)` | `messages.batchModify` (archive = remove INBOX, mark read, star, label) | Re-read the labels ✓ |
| `gmail_summarize_inbox(since)` | search `is:unread newer_than:1d` + read the top N → fast model | — |

### Calendar + Meet (`calendar.ts`, `meet.ts`)
| Tool | Google API | Verification |
|---|---|---|
| `calendar_list(timeMin, timeMax)` | `events.list(singleEvents, orderBy=startTime)` | — |
| `calendar_find_free_slot(attendees[], duration, window)` | `freebusy.query` | — |
| **`calendar_create(title, start, end, attendees[], withMeet=true, description)`** | `events.insert(conferenceDataVersion=1, sendUpdates='all')` with `conferenceData.createRequest{requestId, conferenceSolutionKey:{type:'hangoutsMeet'}}` | `events.get` → `hangoutLink` present + attendees match ✓ |
| `calendar_update(eventId, patch)` / `calendar_delete(eventId)` | `events.patch` / `events.delete` | Re-get ✓ / 410 Gone ✓ |
| `meet_create_instant()` | Meet REST `spaces.create` → `meetingUri` | URI matches `meet.google.com/xxx-xxxx-xxx` ✓ |

### Drive / Docs / Sheets (`drive.ts`, `docs.ts`, `sheets.ts`)
| Tool | API | Verification |
|---|---|---|
| `drive_search(query, type?)` | `files.list(q="name contains … or fullText contains …")` → id, name, mime, link, thumbnailLink | — |
| `drive_read(fileId)` | Docs → `files.export(text/plain)`, Sheets → CSV export, PDF → download + `pdf-parse`, capped at 20k chars | — |
| `docs_create(title, markdown)` | `documents.create` → `batchUpdate` (insertText + heading styles) | `files.get` ✓ |
| `sheets_create(title, headers, rows)` / `sheets_append(sheetId, rows)` | `spreadsheets.create` / `values.append` | Read back the row count ✓ |
| `drive_share(fileId, email, role)` | `permissions.create` (**risky: confirm**) | `permissions.list` ✓ |

### Tasks & Contacts (`tasks.ts`, `contacts.ts`)
| Tool | API | Verification |
|---|---|---|
| `tasks_create(title, due?, notes?, list?)` | Tasks `tasks.insert` (**shows on the phone through the Google Tasks app**) | `tasks.get` ✓ |
| `tasks_list(list?, dueBefore?)` / `tasks_complete(id)` | `tasks.list` / `tasks.patch(status=completed)` | Re-get ✓ |
| **`contacts_search(name)`** | People `searchContacts` + `otherContacts.search` (people you've emailed) + memory aliases ("Mom") | On no match → `error: contact_not_found` + closest names by Levenshtein distance |

### Knowledge, memory, notify
| Tool | Notes |
|---|---|
| `web_search` | OpenAI hosted tool (`openai.tools.webSearch()`); nothing to implement |
| `remember(fact)` / `recall(query)` | `memories` table, injected into the system prompt ("Priya = priya@acme.com", "my manager is Arjun") |
| `notify_me(title, body, channel)` | Web Push (VAPID) to the user's devices, or email to self through Gmail |
| `generate_image(prompt)` (stretch) | `gpt-image-2` → Drive upload → card ("make a banner for the demo and put it in Drive") |

### Device tools (only when the Desktop Companion is online; stretch)
`device_open_app`, `device_open_url`, `whatsapp_send`, `imessage_send`, `device_screenshot`, all executed by the paired Swift app over WebSocket (§11).

---

## 6. Agent engine (`lib/ai/agent.ts`)

### 6.1 Turn loop (AI SDK)
```ts
const result = streamText({
  model: openai.responses(deep ? 'gpt-5.5' : 'gpt-5.4-mini'),
  system: buildSystemPrompt(user, memories, grantedConnectors, now, tz),
  messages,                                  // persisted conversation
  tools: registry.forUser(user, granted),    // only the connectors the user granted
  stopWhen: stepCountIs(15),                 // multi-step loop
  providerOptions: { openai: { reasoningEffort: 'low', parallelToolCalls: true } },
  onStepFinish: persistStep,                 // run_steps rows + usage
});
return result.toUIMessageStreamResponse();   // tool parts stream to Mission Control
```
- Each tool's `execute` is wrapped by `withRun()`: it writes `run_steps` (running → verified/failed), adds a 30 s timeout, maps errors, and calls the **Verifier**.
- **Human-in-the-loop:** risky tools (unless Autopilot is on) are defined **without** `execute`. The client renders a `ConfirmCard`, and on Approve it calls `addToolResult` / re-executes on the server.

### 6.2 System prompt (essentials)
- *You are JARVIS. You complete tasks by calling tools. Never tell the user how to do something you can do yourself.*
- Injected context: user name and email, **current date/time and timezone** (sent from the browser), granted connectors, memories, and today's first three events.
- Defaults: meetings are 30 min with a Meet link and invites sent. "Tomorrow evening" = 6pm. Sign emails with the user's first name. Be concise.
- **Always resolve people with `contacts_search`.** Ask one short question if it's ambiguous. Don't guess recipients.
- After acting, report results as ✓ / ✗ lines. **Never claim success for a step whose `verified` is false.**

### 6.3 Verifier and failure recognition (a judged requirement)
1. **Deterministic post-checks** inside each tool (see the Verification columns in §5). Re-read the created object from Google.
2. **Error classification → recovery**

   | Error | What Jarvis does |
   |---|---|
   | `auth_expired` / `invalid_grant` | Refresh the token. If that fails, show a **Reconnect Google** card |
   | `scope_missing` (403 insufficientPermissions) | Show the connector's **Grant access** card (incremental consent) |
   | `contact_not_found` | Ask "Did you mean …?" with suggestion chips |
   | `not_found` / `conflict` (e.g. time slot busy) | Try another approach: `calendar_find_free_slot` → propose 2 slots |
   | `rate_limited` / 5xx | Retry with backoff (2×), then fail honestly |
3. **Loop guard:** the same tool with the same args failing twice → stop that branch.
4. **Final self-check:** after the loop, the fast model compares the **goal with the verified steps** and returns `{complete, missing[]}`. If something is missing, the run is marked **Partial** with an amber badge instead of a false "Done".
5. **Run status** (`succeeded | partial | failed | needs_input`) drives the orb color, the toast, and the notification for background runs.

### 6.4 Runs as first-class objects
Every chat command, voice command and automation creates a **run** (`runs` + `run_steps`). `/runs/:id` replays it with the same Mission Control animation, which is good for judges ("here's what it did at 8am while I slept").

---

## 7. Automations: the "complete automated system"

### 7.1 Creating one
Users type it in plain English, either in chat ("every weekday at 8am…") or on `/automations`. The model turns it into a spec:
```json
{ "name": "Morning brief", "trigger": { "type": "cron", "cron": "0 8 * * 1-5", "tz": "Asia/Kolkata" },
  "instructions": "Summarize today's meetings, important unread email and tasks due; email it to me; add urgent items to Tasks.",
  "connectors": ["calendar","gmail","tasks"], "autopilot": true }
```
Trigger types:
- `cron`: Inngest scheduled function checks due automations every minute
- `gmail`: "when an email matching `from:(@recruiter.com) OR subject:interview` arrives". Inngest cron polls `history.list` from the stored `historyId` every 5 min
- `calendar`: "10 minutes before any meeting with external guests"
- `manual`: a one-click recipe

### 7.2 Runner
Inngest function `automation.run` → `step.run('agent', runAgentHeadless(user, instructions))`, using the same agent and tools, non-streaming, with steps persisted. It retries transient failures, then calls `notify_me` with the outcome. Failed runs show up red in the feed with the reason.

### 7.3 Recipe gallery (one-click, pre-written prompts)
| Recipe | Connectors |
|---|---|
| ☀️ Morning brief → email + tasks | Calendar, Gmail, Tasks |
| 📥 Inbox zero: archive newsletters, star the important ones, draft replies | Gmail |
| 🤝 Meeting prep: 10 min before, gather the last emails and docs with the attendees into a Doc | Calendar, Gmail, Drive, Docs |
| 🧾 Invoice catcher: invoice emails → save the PDF to Drive "Invoices" → log in a Sheet | Gmail, Drive, Sheets |
| 💼 Job hunter: recruiter emails → reply with availability + resume link → add to tracker Sheet | Gmail, Drive, Sheets, Calendar |
| 📝 Meeting follow-up: after a meeting, email attendees a summary + action items from the Doc | Calendar, Docs, Gmail |

### 7.4 "While you were away" feed
The dashboard opens with *"Jarvis did 6 things since yesterday"*: a list of automation runs with ✓/✗.

---

## 8. Visual wow: UI and animation spec

### 8.1 Design language
Dark HUD aesthetic: background `#05070B`, primary cyan `#00E5FF`, amber `#FFB020` for "thinking", green `#2BFF88` for success, red `#FF3B5C` for failure. Glass panels (`backdrop-blur`, 1px cyan/10% borders). Fonts: **Orbitron** (display), **Inter** (UI), **JetBrains Mono** (data). Subtle scanline and grain overlay.

### 8.2 The Orb (`components/orb/JarvisOrb.tsx`, React Three Fiber)
- **Core:** icosphere with a custom shader. Simplex-noise vertex displacement, fresnel rim glow, an inner plasma gradient driven by `uTime`, `uEnergy` and `uColor`.
- **Rings:** 3–4 torus/line rings at different tilts, counter-rotating, with dashed tick textures.
- **Particles:** ~2k points on a sphere shell that swirl in when thinking and burst out on success.
- **Post-processing:** `@react-three/postprocessing` Bloom + ChromaticAberration (spiked on failure).
- **State machine** (Zustand store `orbState`): `idle` (breathing) · `listening` (energy follows the mic through a Web Audio AnalyserNode) · `thinking` (fast spin, amber) · `acting` (a pulse per tool step) · `speaking` (energy follows the TTS audio level) · `success` (green shockwave) · `failure` (red glitch, 400 ms).
- **Performance:** `dpr={[1,2]}`, pause when the tab is hidden. Fallback: a 2D canvas orb when WebGL is unavailable or `prefers-reduced-motion` is set.

### 8.3 Boot sequence (`BootSequence.tsx`)
Runs after sign-in, once per session. Rings draw in with an SVG stroke-dashoffset animation, mono text types *"INITIALIZING J.A.R.V.I.S…"*, and connector logos orbit and lock in one by one as `/api/connectors/status` resolves each one (✓ or a red ✗ with a Grant button). An optional greeting plays (TTS; needs one click because of autoplay rules).

### 8.4 Command Center layout (`/dashboard`)
```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ ◉ JARVIS      Gmail● Calendar● Drive● Tasks● Contacts●     Autopilot [on]   (avatar)│
├──────────────────────────────┬──────────────────────────┬─────────────────────────┤
│  CHAT                        │        ╭──────────╮       │  MISSION CONTROL        │
│  you: schedule a meet w/…    │        │   ORB    │       │  ● Find Priya      ✓    │
│  jarvis: On it. ▍            │        ╰──────────╯       │  │                       │
│                              │   "Creating the event…"   │  ● Check free/busy ✓    │
│                              │                           │  │                       │
│                              │  ┌ RESULT CARDS ────────┐ │  ◌ Calendar + Meet ⟳    │
│                              │  │ 📅 Demo sync  Fri 4pm │ │  │                       │
│  [☀ Brief] [📥 Inbox zero]    │  │   [Join Meet]         │ │  ○ Email agenda         │
│  ┌────────────────────── 🎙 ⏎┐ │  │ ✉️ To: Priya  SENT ✓  │ │                         │
│  │ Tell Jarvis what to do…   │ │  └──────────────────────┘ │  Run #42 · 6.1s · ✓ 4/4 │
└──┴───────────────────────────┴─┴──────────────────────────┴─────────────────────────┘
```
On mobile it becomes one column: orb on top, a chat/mission toggle, and a voice button docked at the bottom.

### 8.5 Mission Control and cards (Framer Motion)
- A **step node** appears as soon as the tool call starts streaming (from AI SDK tool parts): shimmer while running, a spring-pop ✓ when verified, a shake + red when failed, a hollow amber ✓ for "done but unverified". Animated SVG connector lines run between nodes, and the timer ticks.
- **Cards** keyed by `result.card.type`:
  - `event`: mini week grid where the event block **drops into its slot**, with a Meet button and attendee avatars.
  - `email`: envelope card; the body **types itself out**, then a **SENT** stamp lands with a rotate-in.
  - `doc` / `sheet`: Drive thumbnail (`thumbnailLink`) with an Open button.
  - `task`: checklist item that slides in.
  - `search`: favicon list of sources.
- Hover any step → JSON drawer with args, result and verification evidence (judges love seeing proof).

### 8.6 Small touches
- ⌘K command palette with the recipes.
- Optional subtle SFX (boot chime, step tick, success whoosh), off by default.
- Confetti-free: success is the green shockwave on the orb, nothing cheesy.

---

## 9. Voice (phase 2, after chat is solid)

- **Realtime over WebRTC:** the client calls `/api/voice/session` → server mints an ephemeral secret for `gpt-realtime-2.1-mini` with instructions, a voice, and **one tool: `jarvis_do(task: string)`**.
- **One brain:** the realtime model handles conversation and small talk. Anything actionable goes to `jarvis_do`. The client POSTs it to `/api/agent/run` (session-authed), which runs the **same agent and tools** and streams steps to Mission Control. The final summary goes back into the realtime session as the tool output, and Jarvis speaks it.
- Orb: `listening` follows mic RMS and `speaking` follows the remote audio track's level.
- Push-to-talk (hold space, or tap the mic on mobile) is the default; continuous mode is a toggle.
- Fallback if Realtime misbehaves: browser speech-to-text (`gpt-4o-mini-transcribe` upload) → chat → `gpt-4o-mini-tts` streamed playback.

---

## 10. Data model (Drizzle, `lib/db/schema.ts`)

| Table | Key columns |
|---|---|
| `users`, `accounts`, `sessions`, `verification_tokens` | Auth.js standard. `accounts.refresh_token` / `access_token` **encrypted**, plus `scope` and `expires_at` |
| `profiles` | `user_id`, `timezone`, `autopilot`, `model_pref`, `allowlisted`, `voice` |
| `conversations` / `messages` | `id, user_id, title` / `id, conversation_id, role, parts jsonb, created_at` |
| `runs` | `id, user_id, source (chat/voice/automation), goal, status, started_at, finished_at, tokens` |
| `run_steps` | `id, run_id, idx, tool, title, args jsonb, result jsonb, status, verified, evidence, ms` |
| `automations` | `id, user_id, name, trigger jsonb, instructions, connectors[], autopilot, enabled, last_run_at, state jsonb (e.g. gmail historyId)` |
| `memories` | `id, user_id, fact, created_at` |
| `usage_events` | `user_id, model, input_tokens, output_tokens, ts` |
| `push_subscriptions` | `user_id, endpoint, keys jsonb` |
| `devices` (stretch) | `id, user_id, name, token_hash, last_seen` |

---

## 11. Desktop Companion (stretch; reuses the code in `desktop/`)

The Swift app becomes a thin **local executor**:
1. **Pairing:** on `/settings/devices` the web app shows a 6-digit code. Enter it in the Mac app, which exchanges it for a device token (only its hash is stored).
2. The Mac app keeps a WebSocket open to the backend. It runs on Vercel through a small realtime relay, e.g. **Ably/Pusher**, or a tiny Fly.io WS service.
3. When a device is online, the agent's registry adds `device_*` tools (WhatsApp desktop, iMessage, open app, screenshot + vision). Calls are relayed to the Mac and results stream back.
This shows "decent computer access" without breaking the hosted model. Skip it if time runs short.

---

## 12. Repository layout

```
jarvis/                                  (GitHub: <org>/jarvis, deployed by Vercel)
├── app/
│   ├── (marketing)/page.tsx             landing with orb + Sign in
│   ├── (marketing)/privacy/page.tsx     required by the Google consent screen
│   ├── (marketing)/terms/page.tsx
│   ├── (app)/layout.tsx                 auth gate, top bar, boot sequence
│   ├── (app)/dashboard/page.tsx         Command Center
│   ├── (app)/automations/page.tsx       list, create, recipe gallery
│   ├── (app)/runs/[id]/page.tsx         run replay
│   ├── (app)/connectors/page.tsx        granted scopes, Grant buttons
│   ├── (app)/settings/page.tsx          autopilot, model, voice, devices
│   ├── access/page.tsx                  "request access" for non-allowlisted
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── chat/route.ts                streaming agent (maxDuration 300)
│       ├── agent/run/route.ts           voice/one-shot runs
│       ├── runs/[id]/events/route.ts    SSE
│       ├── connectors/status/route.ts
│       ├── voice/session/route.ts       ephemeral realtime secret
│       ├── push/subscribe/route.ts
│       └── inngest/route.ts
├── auth.ts                              Auth.js config (Google, scopes, adapter wrapper)
├── middleware.ts                        session + allowlist gate
├── lib/
│   ├── ai/{agent.ts, system-prompt.ts, models.ts, verifier.ts, self-check.ts}
│   ├── tools/{registry.ts, result.ts, gmail.ts, calendar.ts, meet.ts, drive.ts, docs.ts,
│   │          sheets.ts, tasks.ts, contacts.ts, memory.ts, notify.ts, device.ts}
│   ├── google/{client.ts (OAuth2 + refresh + decrypt), scopes.ts, mime.ts}
│   ├── db/{schema.ts, index.ts}  drizzle/ (migrations)
│   ├── security/{crypto.ts, ratelimit.ts, allowlist.ts, budget.ts}
│   └── inngest/{client.ts, functions/{automation-tick.ts, automation-run.ts, gmail-watch.ts}}
├── components/
│   ├── orb/{JarvisOrb.tsx, orbShader.ts, Orb2D.tsx, useAudioLevel.ts}
│   ├── boot/BootSequence.tsx
│   ├── chat/{Chat.tsx, Composer.tsx, MessageParts.tsx, ConfirmCard.tsx}
│   ├── mission/{MissionControl.tsx, StepNode.tsx, StepDrawer.tsx}
│   ├── cards/{EventCard, EmailCard, DocCard, TaskCard, SearchCard}.tsx
│   ├── brief/DailyBrief.tsx
│   └── ui/ (shadcn)
├── store/orb.ts                         Zustand
├── public/{manifest.webmanifest, icons/, sfx/, sw.js}
├── desktop/                             Swift companion (optional; from v1)
├── .env.example                         every variable name, no values
├── drizzle.config.ts  next.config.ts  vercel.json (crons not needed: Inngest)
└── README.md                            setup, architecture diagram, demo GIF
```

### Environment variables (`.env.example`)
```
OPENAI_API_KEY=            # server only
OPENAI_MODEL=gpt-5.4-mini
OPENAI_MODEL_DEEP=gpt-5.5
OPENAI_REALTIME_MODEL=gpt-realtime-2.1-mini
AUTH_SECRET=               # npx auth secret
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_TRUST_HOST=true
DATABASE_URL=              # Neon
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
TOKEN_ENC_KEY=             # 32-byte base64: openssl rand -base64 32
ALLOWED_EMAILS=            # comma-separated
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=
VAPID_PUBLIC_KEY=  VAPID_PRIVATE_KEY=  NEXT_PUBLIC_VAPID_PUBLIC_KEY=
```

---

## 13. Deployment and the hour-4 domain switch

**Before H4:** `gh repo create` → push → import into Vercel → add the Neon, Upstash and Inngest integrations (they inject env vars) → add the remaining env vars → first deploy on `jarvis-<team>.vercel.app`. Google OAuth works there via the `vercel.app` redirect URI.

**At H4, when the `.xyz` domain arrives (~20 min checklist):**
1. Vercel → Project → Domains → add `<team>.xyz` and `www.<team>.xyz` (redirect www → apex).
2. At the registrar: `A @ 76.76.21.21` and `CNAME www cname.vercel-dns.com` (or switch nameservers to Vercel). SSL is automatic.
3. Google Console: add the origin `https://<team>.xyz` and the redirect `https://<team>.xyz/api/auth/callback/google`, and add `<team>.xyz` to Authorized domains.
4. Vercel env: no change is needed with `AUTH_TRUST_HOST=true`. Redeploy.
5. Smoke test: sign in → boot → "brief my day" → check that one email arrives.

**Repo hygiene:** `.env*` gitignored (the current local `.env` holding the key is already ignored). Enable GitHub **secret scanning + push protection**. The README covers architecture, setup, the demo GIF and the security notes, which judges read.

---

## 14. Demo script (~4 min, rehearse three times)

| # | Action | Visible result | Requirement shown |
|---|---|---|---|
| 1 | Open `<team>.xyz` → Sign in with Google | Orb landing → consent → **boot sequence**, connectors lock on | Wow, auth |
| 2 | (auto) Daily brief | Animated agenda, inbox and task cards + spoken summary | Multi-app reasoning |
| 3 | "Schedule a Google Meet with Priya tomorrow at 4 for 30 min about the demo and email her an agenda." | Contacts ✓ → Free/busy ✓ → Event + Meet ✓ → Email SENT ✓. Event card drops in. Open Gmail Sent to prove it | **Real multi-step task across apps** |
| 4 | "Find my resume in Drive and reply to the recruiter's latest email with the link and my availability Thursday." | Drive search ✓ → Gmail search ✓ → Calendar free slots ✓ → Reply SENT ✓ | Cross-connector chaining |
| 5 | "Summarize my unread emails into a Google Doc and add the action items to my tasks." | Doc card with thumbnail; tasks slide in; **phone shows them in Google Tasks** | Cross-device |
| 6 | "Every weekday at 8am email me my brief." → click **Run now** | Automation card → run replays live → email arrives | Automated system |
| 7 | "Invite Batman to tomorrow's standup." | Red failed step, "Did you mean Bharat?" chips | **Failure recognition** |
| 8 | (phase 2) Hold space: "Jarvis, what's my next meeting, and move it 30 minutes later." | Orb listens/speaks; Calendar update ✓ | Voice wow |

**Demo hygiene:** a dedicated demo Google account seeded with emails, events, a resume PDF and contacts (Priya, Rahul, Bharat). Autopilot ON. A backup recorded video. Phone hotspot. Judges pre-added as Google test users.

---

## 15. Build timeline (≈30 h, 3–4 people)

**Roles:** **A** Agent + tools · **B** Frontend + orb/animations · **C** Auth/infra/security + automations · **D** Google tools + demo data (with 3 people, D's work is split between A and C)

| Hours | A: Agent | B: Frontend / Wow | C: Auth / Infra / Security | D: Connectors / Demo |
|---|---|---|---|---|
| **H0–1** | `create-next-app`, AI SDK hello-world streaming | Tailwind/shadcn, design tokens, fonts | GitHub repo, Vercel project, Neon + Upstash + Inngest integrations | **Google Cloud project, APIs, consent screen, OAuth client** |
| **H1–4** | Tool registry, `ToolResult`, `withRun` wrapper, system prompt | Orb v1 (R3F core + rings), landing page | Auth.js Google + Drizzle adapter + token encryption + middleware/allowlist | `google/client.ts` refresh; Gmail search/read/send |
| **⏰ H4** | — | — | **Attach `.xyz` domain, update Google redirect URIs, production smoke test** | — |
| **H4–8** | `/api/chat` multi-step loop + run persistence | Chat UI with streaming parts | Rate limits + token budget + `/access` page | Calendar (create with Meet, list, freebusy), Contacts |
| **H8–12** | Verifier + error classification + recovery | **Mission Control** step nodes wired to tool parts | Connectors status API + Grant (incremental scopes) | Tasks, Drive search/read, Docs create, Sheets append |
| **H12–14** | 🔗 **INTEGRATION:** demo flows 3, 4, 5 end to end on production |||
| **H14–18** | Self-check (partial runs), confirm cards / autopilot, memory | Result cards (event/email/doc/task) + animations; boot sequence | Inngest: automation spec parser, cron tick, runner, notify | Gmail triage + reply; Meet instant; seed demo account |
| **H18–22** | Daily brief endpoint + "while you were away" feed | Orb v2: shaders, bloom, state machine, audio reactivity hook | Web push + PWA manifest/service worker | Recipe gallery prompts, test every recipe |
| **H22–24** | 🔗 **FEATURE FREEZE:** full demo ×3 on the `.xyz` domain from two devices |||
| **H24–28** | **Voice phase 2**: ephemeral session + `jarvis_do` delegation | Mobile layout polish, ⌘K palette, run replay page | Security pass: headers, logs, key rotation, spend cap | README + architecture diagram + demo GIF |
| **H28–30** | Rehearse, record backup video, final deploy tag `v1.0` |||

**Cut order if behind:** Desktop Companion → web push → recipe gallery (keep 2) → Gmail trigger automations (keep cron) → voice (keep chat) → Orb v2 shaders (keep v1).
**Never cut:** Google sign-in, key protection, Meet scheduling + email, Mission Control with verification, one automation, the failure demo, the boot sequence.

---

## 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Google "unverified app" screen / test-user limit | Testing mode, judges added as test users, demo on our own seeded account |
| Refresh token missing (Google only issues one on first consent) | `prompt=consent` + `access_type=offline` always. If the token is absent, force re-consent |
| Vercel function timeout on long tasks | `maxDuration=300`. Anything longer or scheduled runs in Inngest steps |
| API key abuse on a public URL | Allowlist + rate limits + token budget + OpenAI project spend cap |
| Model hallucinating success | Tool-level verification + final self-check + "never claim unverified" rule |
| Venue Wi-Fi | Phone hotspot. Everything is cloud-hosted, so the laptop is only a screen |
| Domain DNS propagation delay at H4 | Keep the `vercel.app` URL working as a fallback, with its redirect URI registered too |
| WebGL perf on judge laptops | 2D canvas fallback, cap DPR, pause offscreen |

---

## 17. Definition of done
- [ ] `https://<team>.xyz` live over HTTPS, code public on GitHub, README with architecture + setup + GIF
- [ ] Google sign-in with all connector scopes; tokens encrypted; allowlist and rate limits working; key never in the client bundle (check with `grep` on `.next/static`)
- [ ] Chat agent completes demo flows 3–5 with every step **verified**
- [ ] Mission Control + result cards + orb states + boot sequence
- [ ] At least one automation running on a schedule, visible in the runs feed
- [ ] Failure demo shows detection, explanation and a clarifying question
- [ ] Works on a phone (PWA) with the same account
- [ ] (Phase 2) Realtime voice with spoken replies
