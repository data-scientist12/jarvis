# JARVIS — Personal AI Agent for macOS
### Hackathon implementation plan

> **What it is:** A native SwiftUI Mac app with a JARVIS-style animated orb. You talk or type, and it **does the task** (Gmail, Calendar + Google Meet, Reminders, iMessage/WhatsApp, Chrome, any Mac app). It shows every step as it runs, checks that each step actually worked, and says plainly when something fails.
>
> **Pitch line:** *"ChatGPT tells you how. Jarvis does it."*

---

## 0. Problem statement → how we cover each part

| Requirement | How Jarvis covers it | Demo proof |
|---|---|---|
| Completes **real, multi-step tasks** | Tool-calling agent loop (OpenAI Responses API) with 30+ tools across native APIs, Google APIs, AppleScript, and browser control | "Schedule a Meet with Priya tomorrow 4pm and email her the link": 4 tools, 1 sentence |
| **Across apps** | Connectors: Gmail, Google Calendar/Meet, Apple Calendar, Reminders, Notes, Contacts, Messages, WhatsApp, Chrome, Finder, Music, system controls, shell | Live timeline shows the app switches |
| **Works across devices** | (a) Phone remote: the Mac app serves a web UI on the LAN, scan a QR code to use it. (b) Reminders/Calendar sync through iCloud, so results appear on the iPhone. (c) Optional Telegram bot | Type a command on the phone, watch the Mac do it, and the reminder pops up on the phone |
| **Recognises when a task fails** | Every tool returns a structured result, then a **Verifier** checks the outcome (re-reads the event, checks Gmail Sent, reads the page/screenshot). On failure: retry with another approach, otherwise report the failure honestly. The orb turns red | Planned failure demo: "Text Batman" → contact not found → Jarvis asks which contact. A browser element is missing → falls back to the API |
| **Wow moment** | Arc-reactor orb that reacts to your voice, voice in and voice out, ⌥Space command bar, live step timeline | Opening line: "Jarvis, brief my day" |

---

## 1. Environment (checked on this Mac)

- macOS **27.0**, Xcode **27.0**, Swift **6.4**, Homebrew, Python 3.13, Node
- Installed apps: Google Chrome, Safari, WhatsApp
- `OPENAI_API_KEY` is set in the shell environment
- ⚠️ A test call to `GET /v1/models` returned **HTTP 400**. Check the key before building (step H0): `curl https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"`
- ⚠️ The project folder name ends with a **trailing space** (`jarvis personal ai agent `). Rename it (e.g. `jarvis`) before creating the Xcode project, because the trailing space breaks scripts and build paths.

### Getting the API key into a GUI app
Apps launched from Xcode or Finder **do not inherit your zsh env vars**. `KeyProvider` checks these in order:
1. `ProcessInfo.processInfo.environment["OPENAI_API_KEY"]` (works when launched from `scripts/run.sh`)
2. `/bin/zsh -ilc 'printenv OPENAI_API_KEY'` (reads it from the user's shell profile; runs once at startup)
3. `~/.jarvis/config.json` (manual fallback)

Also add `OPENAI_API_KEY = $(OPENAI_API_KEY)` under Xcode → Scheme → Run → Environment, and launch Xcode from the terminal with `open -a Xcode`.

---

## 2. Architecture

```
┌──────────────────────────── Jarvis.app (SwiftUI, non-sandboxed) ────────────────────────────┐
│                                                                                             │
│  UI LAYER                                                                                    │
│  ┌──────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌────────────┐ ┌─────────────┐  │
│  │ Dashboard    │ │ Chat transcript  │ │ Live Task        │ │ ⌥Space     │ │ Menu bar    │  │
│  │ + Hero Orb   │ │ (streaming)      │ │ Timeline         │ │ Command Bar│ │ extra       │  │
│  └──────┬───────┘ └────────┬─────────┘ └────────┬─────────┘ └─────┬──────┘ └──────┬──────┘  │
│         └──────────────────┴─────────┬──────────┴─────────────────┴───────────────┘         │
│                                      ▼                                                       │
│  VOICE LAYER            ┌────────────────────────┐        REMOTE LAYER                       │
│  Wake word / PTT ──────►│      AgentRuntime      │◄────── LAN web remote (phone, QR)          │
│  STT (OpenAI/on-device) │  plan → act → verify   │◄────── Telegram bot (optional)             │
│  TTS streaming ◄────────│  (Responses API loop)  │                                           │
│                         └───────────┬────────────┘                                           │
│                                     ▼                                                        │
│                         ┌────────────────────────┐                                           │
│                         │     ToolRegistry       │──► Verifier (post-condition checks)        │
│                         └───────────┬────────────┘                                           │
│        ┌───────────┬───────────┬────┴──────┬────────────┬────────────┬───────────┐            │
│        ▼           ▼           ▼           ▼            ▼            ▼           ▼            │
│    Google      EventKit    Messaging    Browser      Desktop       Files      Knowledge       │
│  (Gmail/Cal/  (Cal/Remind) (iMessage,  (Chrome via  (AppleScript, (Spotlight, (web search,    │
│   Meet API)                 WhatsApp)   JS+AS)      AX, screen)   PDFs)       memory)         │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key decisions
| Decision | Choice | Why |
|---|---|---|
| App type | Native SwiftUI, **App Sandbox OFF**, Hardened Runtime with the `apple-events` entitlement | Needs AppleScript, Accessibility, shell, and control of other apps |
| LLM API | OpenAI **Responses API** with function tools, streaming, `previous_response_id` | Built-in multi-turn tool loop, parallel tool calls, hosted `web_search` tool |
| Model | Configurable in `Config.swift`. Default: newest GPT-5-class model on the key for the agent; a mini model for verify and summarize | Speed matters on stage, so use the small model wherever possible |
| Voice | **One agent brain.** Voice is only an input/output layer: STT → same AgentRuntime → streamed TTS | Chat and voice share tools, history, and timeline. Realtime API is a stretch goal (§6.4) |
| Reliability | **API first, UI automation second, visible browser third**, then *show* the result in Chrome | APIs don't flake on stage; opening the result in Chrome still makes it visible |
| Google auth | One-time "Connect Google" button using the OAuth desktop loopback flow. Token stored in `~/.jarvis/google_token.json` | Not "login security", just connector setup. Takes 30 min to build and enables real Meet links |
| Persistence | JSON files in `~/.jarvis/` (history, memory, settings) | No database needed |

---

## 3. Project structure

```
jarvis/
├── Jarvis.xcodeproj               (or project.yml + XcodeGen: `brew install xcodegen`)
├── Jarvis/
│   ├── JarvisApp.swift            App entry, WindowGroup + MenuBarExtra + hotkey registration
│   ├── Info.plist                 Usage descriptions (see §8)
│   ├── Jarvis.entitlements        sandbox=false, automation.apple-events, audio-input
│   ├── Config.swift               Model names, feature flags, autopilot toggle
│   │
│   ├── Core/
│   │   ├── KeyProvider.swift      API key resolution (§1)
│   │   ├── OpenAIClient.swift     Responses API (SSE streaming), audio transcription, TTS
│   │   ├── AgentRuntime.swift     Main loop: stream → tool calls → execute → feed back → repeat
│   │   ├── AgentState.swift       @Observable: messages, steps, orbState, isBusy
│   │   ├── SystemPrompt.swift     Persona + rules + live context (date, TZ, user profile)
│   │   ├── Verifier.swift         Post-condition checks + LLM judge for fuzzy checks
│   │   ├── Memory.swift           Facts about the user ("my manager is Arjun") → ~/.jarvis/memory.json
│   │   └── TaskStep.swift         Step model: id, title, tool, status, detail, evidence
│   │
│   ├── Tools/
│   │   ├── Tool.swift             protocol Tool { name; description; schema; risk; run(args) async -> ToolResult }
│   │   ├── ToolRegistry.swift     Registration, JSON-schema export, dispatch, timing
│   │   ├── Google/
│   │   │   ├── GoogleAuth.swift   OAuth loopback (NWListener on 127.0.0.1), token refresh
│   │   │   ├── GmailTools.swift   search, read, send, reply, draft, archive, label
│   │   │   └── GCalTools.swift    list, create (with Meet link), update, delete, free/busy
│   │   ├── Apple/
│   │   │   ├── CalendarTools.swift   EventKit events (fallback when Google is not connected)
│   │   │   ├── ReminderTools.swift   EventKit reminders: create/list/complete (syncs to iPhone)
│   │   │   ├── ContactTools.swift    CNContactStore lookup by name → phone/email
│   │   │   ├── NotesTools.swift      AppleScript: create/append/search notes
│   │   │   └── MessagesTools.swift   AppleScript: send iMessage/SMS
│   │   ├── WhatsAppTools.swift    whatsapp:// deep link + keystroke send, or WhatsApp Web via Browser
│   │   ├── Browser/
│   │   │   ├── ChromeBridge.swift AppleScript: open URL, run JS in active tab, list tabs
│   │   │   ├── dom_snapshot.js    Injected script: numbered list of interactive elements
│   │   │   └── BrowserTools.swift open, read_page, click(id), type(id,text), press, scroll, wait_for
│   │   ├── Desktop/
│   │   │   ├── AppTools.swift     open/quit/focus app, open URL/file
│   │   │   ├── AppleScriptTool.swift  run model-written AppleScript (risk: medium)
│   │   │   ├── ShellTool.swift    zsh command with timeout (risk: high → confirm)
│   │   │   ├── ScreenTools.swift  ScreenCaptureKit screenshot → vision "what's on my screen"
│   │   │   ├── InputTools.swift   CGEvent keystrokes/hotkeys, clipboard read/write
│   │   │   └── SystemTools.swift  volume, brightness, dark mode, DND/focus, lock, battery, wifi
│   │   ├── FileTools.swift        Spotlight (mdfind), read text/PDF (PDFKit), move, summarize
│   │   └── KnowledgeTools.swift   hosted web_search, weather, remember/recall facts
│   │
│   ├── Voice/
│   │   ├── AudioEngine.swift      AVAudioEngine mic tap, RMS level → orb, VAD (silence detect)
│   │   ├── WakeWord.swift         On-device SFSpeechRecognizer (or SpeechAnalyzer) listens for "Jarvis"
│   │   ├── Transcriber.swift      Uploads the utterance to OpenAI transcription, on-device fallback
│   │   └── Speaker.swift          OpenAI TTS (streamed PCM) via AVAudioPlayerNode, output level → orb
│   │
│   ├── Remote/
│   │   ├── RemoteServer.swift     Network.framework HTTP + WebSocket server on :8765
│   │   ├── remote.html            Mobile UI: mini orb, chat, timeline (served from the bundle)
│   │   └── TelegramBridge.swift   (optional) long-poll bot → AgentRuntime
│   │
│   └── UI/
│       ├── DashboardView.swift    Layout (§5)
│       ├── Orb/
│       │   ├── JarvisOrbView.swift   TimelineView + Canvas rings, state machine
│       │   ├── OrbShaders.metal      Plasma core [[stitchable]] shader
│       │   └── ParticleField.swift   Background particles that gather while thinking
│       ├── ChatView.swift         Bubbles, streaming text, inline action cards
│       ├── TimelineView.swift     Live steps with status icons and evidence thumbnails
│       ├── ConfirmCard.swift      "Send this email?" Approve / Edit / Cancel (skipped in Autopilot)
│       ├── TodayWidgets.swift     Next meeting, unread count, reminders due, weather
│       ├── CommandBar.swift       Floating NSPanel, ⌥Space, Spotlight-style
│       └── SettingsView.swift     Connect Google, permissions checklist, model, voice, autopilot
└── scripts/
    ├── run.sh                     xcodebuild + launch with env inherited
    ├── grant_permissions.md       Pre-demo TCC checklist
    └── demo_seed.sh               Seed calendar events, emails, contacts for a clean demo
```

---

## 4. The agent core (the most important part)

### 4.1 Loop (`AgentRuntime.run(userInput)`)
```
1. Append user message. orb = .thinking
2. POST /v1/responses  { model, instructions: SystemPrompt.build(), input, tools: registry.schemas,
                         previous_response_id, stream: true, parallel_tool_calls: true }
3. Stream:
     response.output_text.delta     → append to chat bubble live (and to TTS sentence buffer)
     response.function_call_arguments.done → queue tool call
4. For each tool call (parallel when independent):
     a. timeline.add(step: humanTitle(call), status: .running)  e.g. "Creating Google Calendar event"
     b. if tool.risk == .high && !autopilot → await ConfirmCard approval
     c. result = await tool.run(args)                    // timeout 30 s
     d. verdict = await Verifier.check(call, result)      // §4.3
     e. step.status = verdict.ok ? .verified : .failed; step.evidence = verdict.evidence
     f. return function_call_output { ok, data, error, verification } to the model
5. If tool calls were made → loop to 2 (max 15 iterations, then stop and report)
6. Final text → chat + TTS. orb = .success or .failure (based on step statuses) → .idle
```

### 4.2 Tool contract
```swift
enum Risk { case read, write, high }          // high = send message/email, delete, shell

struct ToolResult: Codable {
    let ok: Bool
    let summary: String          // one line for the timeline: "Event created: Sync w/ Priya, Fri 4:00 PM"
    let data: JSONValue?         // IDs, links, etc. passed back to the model
    let error: String?           // machine-readable cause: "contact_not_found", "element_missing"
    let suggestion: String?      // "Try browser_open with https://mail.google.com instead"
    let verifyHint: VerifyHint?  // what the Verifier should re-check (e.g. .gcalEvent(id))
}
```

### 4.3 Verifier: how Jarvis detects failure
| Action | Deterministic post-check |
|---|---|
| Calendar event created | Re-fetch by ID; check the time, attendees, and `hangoutLink` |
| Email sent | Gmail `messages.get(id)` has the `SENT` label; recipient matches |
| Reminder created | `EKEventStore.calendarItem(withIdentifier:)` exists |
| iMessage sent | AppleScript: last message in that chat matches the text |
| WhatsApp sent | Screenshot of the WhatsApp window → vision check that the message bubble is visible |
| Browser action | Re-snapshot the DOM: URL changed / expected text present / element state |
| App opened | `NSWorkspace.runningApplications` contains the bundle ID and it is frontmost |
| Shell/AppleScript | Exit code and stderr; output non-empty when output was expected |

For fuzzy goals, an **LLM judge** (mini model) gets the goal, the action, and the evidence (text or screenshot), and returns `{success, reason}`.

**Recovery policy** (in the system prompt and enforced in code):
1. On failure, the model sees `error` + `suggestion` and must try **one different strategy** (API ↔ browser ↔ AppleScript).
2. The same tool with the same args fails twice → mark the task failed. No infinite loops.
3. Missing information (ambiguous contact, no time given) → ask *one* concise question. Don't guess on sends.
4. The final message always lists what succeeded ✓, what failed ✗, and why.

### 4.4 System prompt (essentials)
- You are JARVIS, an executive agent on the user's Mac. **You perform actions with tools; you never give the user instructions for something you can do yourself.**
- Context injected every turn: current date/time/timezone, user name/email, frontmost app, Chrome active tab title, memory facts, Google connected yes/no.
- Defaults: meetings are 30 min with a Google Meet link and use the attendee's email from Contacts. "Tomorrow evening" = 6pm. Use concise British-butler tone, 1–2 sentences when spoken.
- Always resolve people through `contacts_search` before messaging. Always verify. Prefer APIs over UI automation.
- Spoken output: no markdown, no URLs read aloud.

---

## 5. UI / UX: the "wow" layer

### 5.1 Dashboard layout (1440×900, dark, glassmorphic, cyan #00E5FF + amber accents)
```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  JARVIS                        ● Google ● Mic ● Remote: 192.168.1.5:8765 [QR]  ⚙ │
├──────────────────────────────────────────────┬───────────────────────────────────┤
│                                              │  LIVE TASK TIMELINE               │
│              ╭───── HERO ORB ─────╮          │  ✓ Found Priya Sharma (Contacts)  │
│              │  rotating HUD rings │          │  ✓ Checked free/busy Fri 4–4:30   │
│              │   plasma core       │          │  ⟳ Creating event + Meet link…    │
│              ╰─────────────────────╯          │  ○ Emailing invite                │
│        "Scheduling your meeting with Priya…" │  ○ Opening in Chrome              │
│                                              ├───────────────────────────────────┤
│  ┌─ chat transcript (streaming) ───────────┐ │  TODAY                            │
│  │                                          │ │  ▸ 11:00 Design review (Meet)     │
│  └──────────────────────────────────────────┘ │  ▸ 7 unread · 2 important         │
│  [Brief my day] [Clear inbox] [Meet w/…]      │  ▸ 3 reminders due · 28° Sunny    │
│  ┌──────────────────────────────────── 🎙 ⏎ ┐ │                                   │
│  │ Ask Jarvis to do anything…               │ │                                   │
│  └──────────────────────────────────────────┘ │                                   │
└──────────────────────────────────────────────┴───────────────────────────────────┘
```

### 5.2 Hero orb: `JarvisOrbView`
Built with `TimelineView(.animation)` + `Canvas`, plus a Metal `[[stitchable]]` shader for the core. Driven by `orbState` and a live `audioLevel` (0–1).

**Layers (inside → out):**
1. **Plasma core:** Metal `colorEffect` shader using fractal noise + radial falloff, cyan → white hot center, with a `time` uniform.
2. **Inner ring:** solid arc with 60 tick marks, rotates slowly clockwise.
3. **Segmented ring:** 8 arcs with gaps, counter-rotating, and an angular gradient trail.
4. **Data ring:** thin dashed ring with small text glyphs (hex codes), slow rotation.
5. **Outer halo:** blurred glow with `.blendMode(.plusLighter)`, scaled by `audioLevel`.
6. **Particle field:** ~300 particles in Canvas. They drift while idle and spiral inward while thinking.

**State machine (all transitions are spring-animated):**
| State | Look |
|---|---|
| `idle` | Slow breathing (scale 1.0↔1.03, 4 s), slow ring rotation, dim cyan |
| `listening` | Rings expand, halo pulses with **mic RMS**, a radial waveform ring appears |
| `thinking` | Rings spin 4× faster in opposite directions, particles converge, amber accents |
| `acting` | A pulse is emitted for each tool step (ripple synced with timeline steps) |
| `speaking` | Core brightness and waveform follow the **TTS output level** |
| `success` | Green-white shockwave ripple, then back to idle |
| `failure` | Red tint, 300 ms glitch/jitter (shader offset), then a calm amber |

**Boot sequence on launch (first 3 s, big first impression):** rings draw in one at a time (`trim` 0→1), the HUD text types out "SYSTEMS ONLINE · GMAIL ✓ CALENDAR ✓ VOICE ✓", a short chime plays, and Jarvis says *"Good evening, Siddharth. You have 3 meetings tomorrow."*

### 5.3 Other UI moments
- **⌥Space Command Bar:** floating `NSPanel` (non-activating) with a mini orb. Use Jarvis from any app without switching windows. Register the hotkey with `RegisterEventHotKey` (Carbon) or the `KeyboardShortcuts` package.
- **Menu bar extra:** mini orb icon, last task status, and a "Listen" button.
- **Inline result cards in chat:** event card (title, time, Meet link button), email card, message bubble preview.
- **Evidence thumbnails:** timeline steps that used the browser or screen show a small screenshot.
- **Autopilot toggle:** ON skips confirm cards (for demo speed). OFF shows Approve/Edit before sends.

---

## 6. Voice

### 6.1 Pipeline (MVP, reliable)
```
[Wake word "Jarvis" (on-device) OR hold ⌥ / click mic]
   → AudioEngine records, VAD ends on 700 ms silence
   → Transcriber: OpenAI transcription model (fallback: on-device SFSpeechRecognizer)
   → AgentRuntime (same as chat; transcript shown in chat)
   → Speaker: split the streamed text into sentences → TTS per sentence → play as it arrives
```
- Start TTS on the **first sentence**, not the full reply. This cuts perceived latency by about half.
- Play an acknowledgement right away when speech ends ("On it.", pre-generated and cached as audio) so there is never dead air.
- **Barge-in:** if the user speaks while Jarvis is talking, stop playback and listen.

### 6.2 Wake word
`SFSpeechRecognizer` continuous on-device recognition with `requiresOnDeviceRecognition = true`. Restart the request every ~50 s (task limit). Trigger when a partial result contains "jarvis". Keep it behind a toggle so a noisy venue doesn't false-trigger; push-to-talk is the stage default.

### 6.3 Voice persona
Calm, slightly formal, British-butler. Use a deep TTS voice, and in the TTS call include instructions like "speak calmly, confident, slightly British, like an AI butler".

### 6.4 Stretch: Realtime API
Swap the pipeline for an OpenAI Realtime WebSocket session with the same tool schemas, for true speech-to-speech and sub-second replies. Only do this if the MVP is done by hour 24.

---

## 7. Connector specs (tool list for the LLM)

Keep descriptions short and imperative; the model picks tools better that way. **Bold = MVP must-have.**

### Google (Gmail + Calendar + Meet), REST via `URLSession`
| Tool | Implementation notes |
|---|---|
| **`gmail_search(query, max)`** | `users.messages.list?q=` → batch `get` (format=metadata) → from, subject, snippet, date |
| **`gmail_read(id)`** | Decode the base64url `text/plain` part; HTML → text fallback |
| **`gmail_send(to, subject, body, cc?)`** | Build an RFC 2822 message → base64url → `messages.send`. Verify the `SENT` label |
| **`gmail_reply(message_id, body)`** | Set `threadId`, `In-Reply-To`, `References` headers |
| `gmail_draft(...)`, `gmail_archive(ids)`, `gmail_label(...)` | For "clear my inbox" (archive newsletters, star important ones) |
| **`gcal_list(from, to)`** | `events.list`, singleEvents=true, orderBy=startTime |
| **`gcal_create(title, start, end, attendees[], with_meet=true, description?)`** | `events.insert?conferenceDataVersion=1&sendUpdates=all` with `conferenceData.createRequest { requestId: UUID, conferenceSolutionKey: { type: "hangoutsMeet" } }`. Returns `hangoutLink`. **This is the "schedule a Google Meet" hero action** |
| `gcal_update / gcal_delete / gcal_freebusy` | Reschedule ("push my 3pm by an hour"), find free slots |
| `meet_instant()` | Create an event "now" with Meet, open `hangoutLink` in Chrome, so the user is in the call within 3 s |

**Google setup (do it in the first 2 hours, it is the critical path):** Google Cloud console → new project → enable the Gmail API and Google Calendar API → OAuth consent screen (External, **Testing**, add your demo Gmail as a test user) → Credentials → OAuth client ID type **Desktop app**. Scopes: `gmail.modify`, `gmail.send`, `calendar`. Loopback flow: `NWListener` on a random port, open the consent URL in the browser, catch `?code=`, exchange it for tokens, auto-refresh.

### Apple native
| Tool | Implementation |
|---|---|
| **`reminders_create(title, due?, list?, notes?)`** | EventKit `EKReminder` + alarm. **Syncs to the iPhone through iCloud** (cross-device moment) |
| **`reminders_list(filter)` / `reminders_complete(id)`** | `fetchReminders(matching:)` |
| `calendar_create / calendar_list` | EventKit. Fallback if Google isn't connected, and covers iCloud calendars |
| **`contacts_search(name)`** | `CNContactStore.unifiedContacts(matching:)` → names, phones, emails. Fuzzy match + memory aliases ("Mom") |
| **`imessage_send(to, text)`** | AppleScript: `tell application "Messages" to send "…" to participant "…" of account 1 whose service type = iMessage` |
| `notes_create(title, body)` / `notes_search` | AppleScript to Notes |
| `music_control(action, query?)` | AppleScript to Music/Spotify: play, pause, next, play a playlist |

### WhatsApp
**`whatsapp_send(contact, text)`**: resolve the phone number through Contacts → `open "whatsapp://send?phone=<E164>&text=<urlencoded>"` → wait for the window → CGEvent ⏎ (needs Accessibility) → verify by screenshot. Fallback: WhatsApp Web through the Browser tools.

### Browser (Chrome), the generalist that handles anything not covered above
Setup: Chrome → View → Developer → **Allow JavaScript from Apple Events** (one-time).
| Tool | Implementation |
|---|---|
| **`browser_open(url, new_tab=true)`** | AppleScript `tell application "Google Chrome" to open location` |
| **`browser_read()`** | Inject `dom_snapshot.js`: walk visible interactive elements (a, button, input, [role=button], [contenteditable]), tag each with `data-jarvis-id=N`, return `[{id, role, label, value}]` + page title/URL + visible text (truncated to ~6k chars) |
| **`browser_click(id)` / `browser_type(id, text, submit?)`** | JS `el.click()`; for typing, focus + set value + dispatch `input`/`change` (React-safe native setter). For contenteditable (Gmail/WhatsApp Web), use `document.execCommand('insertText')` |
| `browser_press(key)`, `browser_scroll`, `browser_wait_for(text, timeout)` | Polling JS |
| `browser_screenshot()` | `ScreenCaptureKit` of the Chrome window, used for verification and as a vision fallback |

This turns "open Google Meet and schedule a meeting" into a visible on-screen action. It is also the fallback when an API isn't available (LinkedIn, Notion web, flight check-in, etc.).

### Desktop / computer access
| Tool | Notes |
|---|---|
| **`open_app(name)` / `open_url(url)` / `open_file(path)`** | `NSWorkspace` |
| **`run_applescript(script)`** | The model writes AppleScript for anything scriptable (Finder, Mail, Keynote, Safari, System Events). Risk: write. Very flexible |
| `run_shell(command)` | `/bin/zsh -lc`, 20 s timeout, output capped. Risk: high → confirm unless autopilot |
| **`screen_describe(question)`** | ScreenCaptureKit screenshot → vision model → answer. Powers "what's on my screen" and "summarize this page and make reminders from it" |
| `type_text(text)`, `press_keys(combo)`, `clipboard_get/set` | CGEvent / NSPasteboard |
| `system_set(setting, value)` | Volume, brightness, dark mode (AppleScript System Events), Focus/DND (Shortcuts CLI), lock screen |
| `run_shortcut(name, input?)` | `shortcuts run "<name>"`, which exposes the user's Shortcuts library (HomeKit, etc.) |

### Files & knowledge
| Tool | Notes |
|---|---|
| `files_search(query)` | `mdfind` (Spotlight) |
| `file_read(path)` | Text, or PDFKit text extraction → summarize / extract action items |
| **`web_search`** | OpenAI hosted tool, no implementation needed |
| `remember(fact)` / `recall(query)` | `~/.jarvis/memory.json`, injected into the system prompt |
| `daily_brief()` | Compound tool: gcal today + gmail important unread + reminders due + weather → model writes the spoken brief |

---

## 8. Permissions & entitlements (TCC): pre-grant before the demo

**Info.plist keys:**
`NSAppleEventsUsageDescription`, `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription`, `NSCalendarsFullAccessUsageDescription`, `NSRemindersFullAccessUsageDescription`, `NSContactsUsageDescription`, `NSLocalNetworkUsageDescription` (remote server).

**Entitlements:** `com.apple.security.app-sandbox = false`, `com.apple.security.automation.apple-events = true`, `com.apple.security.device.audio-input = true`.

**Manual grants (System Settings → Privacy & Security):** Accessibility (CGEvent typing), Screen Recording (ScreenCaptureKit), Automation (Chrome, Messages, Notes, System Events, Music), Calendars, Reminders, Contacts, Microphone, Speech Recognition.

`SettingsView` shows a **Permissions checklist** with a green or red dot per permission and a "Grant" button that triggers the prompt or opens the right Settings pane (`x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`).

> ⚠️ TCC grants are tied to the code signature. Sign with a **stable "Apple Development" identity** (not ad-hoc), or every rebuild will ask for permissions again.

---

## 9. Cross-device

1. **LAN Remote (MVP, ~2 h):** `RemoteServer` (Network.framework) serves `remote.html` and a WebSocket at `ws://<mac-ip>:8765`. The phone sends `{type:"command", text}`. The server streams `{type:"delta"|"step"|"orbState"}` back, so the phone shows the same timeline and a CSS mini orb. A QR code in the dashboard header (CoreImage `CIQRCodeGenerator`) opens it. Phone mic → Web Speech API on the phone (works in iOS Safari).
2. **iCloud sync (free):** reminders, Apple Calendar events, and Notes created by Jarvis appear on the iPhone/iPad/Watch within seconds. Call this out on stage.
3. **Telegram bot (stretch, ~1.5 h):** works off-network too. BotFather token → long-poll `getUpdates` → AgentRuntime → `sendMessage` with a step summary. Also handles "notify me when done".
4. **Proactive notifications (stretch):** a scheduler checks every 5 min. Example: "Meeting in 10 min, the Meet link is ready. Want me to open it?" (macOS notification + Telegram).

---

## 10. Demo script (rehearse until it's muscle memory)

| # | Say / do | What the audience sees | Shows |
|---|---|---|---|
| 1 | Launch app | Orb boot sequence, "Good evening, Siddharth…" | Wow, voice |
| 2 | 🎙 "Jarvis, brief my day." | Orb listens → thinks → speaks a 20 s brief. Timeline: Calendar ✓ Gmail ✓ Reminders ✓ Weather ✓ | Multi-app read |
| 3 | 🎙 "Schedule a Google Meet with Priya tomorrow at 4 for 30 minutes about the demo, and email her the link." | Contacts ✓ → free/busy ✓ → event + Meet ✓ → Gmail sent ✓ (verified) → Chrome opens the event | **Hero multi-step task** |
| 4 | ⌨️ "Reply to Rahul's latest email saying I'll send the deck by Friday, and remind me Thursday 6pm." | Gmail reply ✓, reminder ✓ | Chat path |
| 5 | 🎙 "Text Mom on WhatsApp that I'll be late for dinner." | WhatsApp opens, message types itself, sends ✓ (screenshot verified) | Computer control |
| 6 | 🎙 "Text Batman that I'm on my way." | Contacts ✗ → red orb flicker → "I couldn't find Batman in your contacts. Did you mean Bharat?" | **Failure detection** |
| 7 | 📱 Scan the QR code, type on the phone: "Add buy milk to my reminders." | Mac timeline updates live, the reminder appears on the phone | **Cross-device** |
| 8 | ⌥Space over a web article: "Summarize this and add the action items to Notes." | Screen read ✓ → Notes ✓ | Context awareness |
| 9 | (closer) "Jarvis, start an instant meeting and send the link to the team WhatsApp group." | Chrome opens Meet, the link goes to the group | Wow ending |

**Demo hygiene:** a dedicated demo Google account with seeded emails and events (`demo_seed.sh`), demo contacts (Priya, Rahul, Mom, Bharat, with the team's real numbers), **Autopilot ON**, phone hotspot as a Wi-Fi backup, a **recorded backup video**, Do Not Disturb on, and every TCC prompt granted beforehand.

---

## 11. Build schedule (≈36 h, 3–4 people)

**Roles:** **A** = Agent core + Google · **B** = UI / Orb / animations · **C** = Apple/desktop/browser tools · **D** = Voice + Remote + demo (or split between A and C if there are 3 people)

| Hours | A: Agent/Google | B: UI/Orb | C: Tools | D: Voice/Remote |
|---|---|---|---|---|
| **H0–2** | Rename folder, check the API key, Xcode project + entitlements, `OpenAIClient` streaming hello world | Dashboard skeleton, color tokens, fonts | `Tool` protocol + registry, `open_app`, `run_applescript` | Google Cloud project + OAuth client + test users |
| **H2–6** | `AgentRuntime` loop with tool calling and streaming; `SystemPrompt` | Orb v1: Canvas rings + states | EventKit reminders + calendar, Contacts | `GoogleAuth` loopback flow + token refresh |
| **H6–10** | Gmail tools (search/read/send/reply) | Chat view + streaming bubbles | iMessage, WhatsApp, Notes | AudioEngine + push-to-talk + transcription |
| **H10–14** | GCal tools + **Meet creation**, `daily_brief` | **Timeline view** wired to steps | Chrome bridge + `dom_snapshot.js` + browser tools | Speaker TTS streaming + sentence chunking |
| **H14–16** | 🔗 **INTEGRATION CHECKPOINT:** demo flows 2, 3, 4 work end to end from chat |||
| **H16–20** | **Verifier** + recovery policy + structured errors | Orb v2: Metal core, particles, audio reactivity, success/failure FX | Screen capture + `screen_describe`, system controls | Wake word, orb ↔ voice level wiring |
| **H20–24** | Memory, confirm cards, autopilot | Boot sequence, result cards, Today widgets | Shell tool, Shortcuts, files | LAN remote server + `remote.html` + QR |
| **H24–28** | 🔗 **FEATURE FREEZE.** Full demo run ×3; fix the top 5 bugs |||
| **H28–32** | Prompt tuning for speed and tone | ⌥Space command bar, menu bar extra, polish | Fallback paths (API ↔ browser) | Telegram (stretch), seed script |
| **H32–36** | Rehearse, record the backup video, slides (3 max: problem → live demo → architecture) |||

**Cut order if behind:** Telegram → wake word → command bar → Metal shader (keep Canvas rings) → shell tool. **Never cut:** the orb, the timeline, Meet scheduling, the Verifier, voice push-to-talk.

---

## 12. Performance & reliability tips
- Use the **mini model** for the verifier judge, summaries, and the daily brief. Use the big model only for planning.
- Keep tool descriptions short, ≤ 25 tools exposed per turn. Group rarely used ones behind `run_applescript`.
- Pre-warm: on launch, refresh the Google token, request EventKit access, and open a keep-alive HTTP/2 connection to OpenAI.
- Cache the "On it." / "Done." audio clips.
- Hard 30 s timeout per tool; the whole task stops at 15 iterations, with a graceful failure report.
- Log every request, tool call, and result to `~/.jarvis/logs/<date>.jsonl` so stage bugs can be debugged in minutes.

## 13. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Google OAuth consent friction | Testing mode + test users, set up on H0. EventKit + Chrome fallback if it breaks |
| TCC prompts mid-demo | Stable signing identity, Permissions checklist, a full dry run on the demo Mac |
| Chrome JS-from-AppleScript disabled | Checklist item; `ChromeBridge` detects the error and tells the user how to enable it |
| WhatsApp UI changes / focus issues | Deep link + ⏎ is minimal; screenshot verify; WhatsApp Web fallback |
| Venue Wi-Fi / latency | Hotspot, streaming everywhere, instant acknowledgement audio, backup video |
| Model takes wrong/destructive action | Risk tiers, confirm cards outside autopilot, no delete tools in the demo build |
| Voice misfires in a noisy room | Push-to-talk default, wake word toggle, typed fallback always visible |

---

## 14. Definition of done (MVP)
- [ ] App launches with the boot animation, the orb reacts to all 7 states
- [ ] Chat and push-to-talk voice both run the same agent with streamed text + speech
- [ ] Gmail search/read/send/reply, Google Calendar create with a **real Meet link**, Reminders, Contacts, iMessage, WhatsApp, Chrome open/read/click/type, open app, AppleScript, screen describe
- [ ] Live timeline with ✓/✗ per step, backed by Verifier evidence
- [ ] Failure demo reliably shows detection + clarification
- [ ] Phone remote via QR works on the hotspot
- [ ] All 9 demo flows pass 3 times in a row on the demo Mac
