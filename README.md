# Jarvis — a personal AI agent that does the work

> ChatGPT tells you how. **Jarvis does it.**

Jarvis is a hosted agent that completes real, multi-step tasks across Gmail, Google Calendar, Meet, Drive/Docs/Sheets, Tasks and Contacts, and on your own Mac (open apps, open Chrome tabs). It **verifies every action** by re-reading the result from the source, tells you honestly when something failed, and runs repetitive jobs on a schedule while you're away.

## What it can do
- **Do it, don't explain it:** "Schedule a 30-min Meet with Priya tomorrow at 4 and email her the agenda" → resolves Priya in Contacts, checks the calendar, creates the event with a real Meet link, sends the email, and proves each step.
- **Repetitive work, automated:** inbox zero, unsubscribe from newsletters, follow-ups on unanswered emails, invoice attachments → Drive, turning emails into tasks, focus-time blocking. Describe an automation in plain English ("every weekday at 9am…") and it runs on schedule.
- **Computer access:** "open Spotify", "open Gmail and Calendar in Chrome", "close my Zomato tab".
- **Recognises failure:** every write is verified (e.g. the sent email carries Gmail's SENT label). A reviewer model (`gpt-5.5`) checks the goal against the evidence and marks runs *Done / Partial / Failed / Needs input*.

## Architecture
```
Browser (Next.js 16 / React 19, Apple-style UI)
   │  SSE (AI SDK UI message stream)
Next.js route handlers ── Better Auth (Google + email, encrypted tokens, allowlist)
   │                      rate limits · daily token budget · audit log (runs/steps)
   ├─ Executor agent  gpt-5.4-mini  → 50+ tools (Google APIs, device bridge, memory, web search)
   ├─ Reviewer        gpt-5.5       → verifies the goal was truly met
   ├─ Automations     plain English → cron/Gmail triggers → headless runs
   └─ Device bridge   queue ⇄ local executor (dev) / paired companion (hosted) → macOS apps & Chrome
Postgres (Drizzle) · optional Upstash Redis for rate limiting
```

## Security
- `OPENAI_API_KEY` exists only in server environment variables; every route requires a session.
- Google OAuth tokens are encrypted at rest; per-user data isolation on every query.
- Sign-up is limited by `ALLOWED_EMAILS` (production **fails closed** if it is empty).
- Per-user rate limits and a daily token budget; high-impact tools (send, delete, quit app) need approval unless Autopilot is on.
- The device bridge only runs an allow-listed set of commands (no shell), http(s) URLs only.

## Run locally
```bash
cd web
cp .env.example .env.local     # fill in OPENAI_API_KEY, BETTER_AUTH_SECRET, DATABASE_URL, Google OAuth client
npx drizzle-kit push           # create tables
env -u OPENAI_API_KEY npm run dev   # open http://localhost:3000
```
Google setup: create an OAuth *Web application* client, enable the Gmail, Calendar, Meet, Drive, Docs, Sheets, Tasks and People APIs, and add `http://localhost:3000/api/auth/callback/google` as a redirect URI (`https://<your-domain>/api/auth/callback/google` when hosted).

## Hosted: Mac companion
A hosted site can't open apps on your Mac. In **Settings → Mac companion** pair a device and run
`npm run companion -- --url https://<your-domain> --token <token>` on the Mac.

## Layout
`web/` Next.js app · `desktop/` earlier native macOS prototype · `PLAN.md` implementation plan · `web/CONTRACTS.md` build contracts.
