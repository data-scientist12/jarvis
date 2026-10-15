# Google connector tools (Stream A)

`import { googleTools } from "@/lib/tools/google"` exports every tool as a `JarvisTool[]`. Each tool gets the per-user OAuth client from `ctx.google()`, never throws (errors are mapped to contract error codes in `util.ts`), and every write re-reads from Google to set `verified` + `evidence`.

Files: `gmail.ts`, `calendar.ts`, `meet.ts`, `drive.ts`, `docs.ts`, `sheets.ts`, `tasks.ts`, `contacts.ts`, `util.ts` (error mapping, timezone math, MIME builder, helpers), `smoke.ts` (read-only live check).

## Gmail (connector `gmail`)
- `gmail_search` (read): search with Gmail syntax; id, threadId, from, subject, snippet, date, unread.
- `gmail_read` (read): one email, plain-text body (8k cap), attachments, link.
- `gmail_read_thread` (read): whole conversation for summarising.
- `gmail_send` (high): send a new email, optional Drive attachments; verified by SENT label.
- `gmail_reply` (high): reply (or reply-all) in the same thread; verified by SENT label + threadId.
- `gmail_create_draft` (write): save a draft; verified via drafts.get.
- `gmail_draft_reply` (write): draft a threaded reply; verified via drafts.get.
- `gmail_bulk_action` (high): archive / read / unread / star / important / trash / label up to 500 emails by query or ids; verified by re-reading a sample.
- `gmail_find_unreplied` (read): sent threads where the user wrote last and nobody replied (follow-up candidates).
- `gmail_list_subscriptions` (read): newsletter senders (List-Unsubscribe) grouped by volume.
- `gmail_unsubscribe` (high): RFC 8058 one-click POST or unsubscribe email, then archive the sender's inbox mail.
- `gmail_save_attachments_to_drive` (write): save attachments from matching emails into a Drive folder, skipping duplicates.
- `gmail_list_labels` (read): label names and ids.

## Calendar (connector `calendar`; all times in the user's timezone)
- `calendar_list_events` (read): events in a range (default today).
- `calendar_find_free_slots` (read): free slots across the user's and attendees' calendars (30-min grid, weekdays, working hours).
- `calendar_create_event` (high): event with Meet link, attendees, recurrence; verified by re-get (start, attendees, Meet link).
- `calendar_update_event` (write): reschedule / rename / add attendees; verified by re-get.
- `calendar_delete_event` (high): cancel an event; verified by 404/410/cancelled.
- `calendar_respond` (write): accept / decline / tentative; verified by re-get.
- `calendar_block_focus_time` (write): auto-book focus blocks in free gaps across a date range; verified via events.list.

## Meet (connector `meet`)
- `meet_create_instant` (write): instant Meet room via Meet API v2 (falls back to a calendar event with a Meet link); verified via spaces.get.

## Drive / Docs / Sheets (connector `drive`)
- `drive_search` (read): find files by name/content and type.
- `drive_read_file` (read): text of Docs, Sheets (CSV), Slides and text files.
- `drive_create_folder` (write): create a folder; verified via files.get.
- `drive_share` (high): share with a person by email; verified via permissions.list.
- `docs_create` (write): new Google Doc from markdown-ish text; verified via documents.get.
- `docs_append` (write): append to a Doc; verified by re-reading text.
- `sheets_create` (write): new Sheet with header + rows; verified via values.get.
- `sheets_append_rows` (write): append rows; verified via updatedRows + read-back.
- `sheets_read` (read): read a range (200-row cap).

## Tasks (connector `tasks`)
- `tasks_list` (read): open tasks, optional due filter.
- `tasks_create` (write): one to-do; verified via tasks.get.
- `tasks_create_many` (write): up to 50 to-dos; every one re-read.
- `tasks_complete` (write): complete by id or title match; verified via tasks.get.
- `tasks_list_tasklists` (read): the user's task lists.

## Contacts (connector `contacts`)
- `contacts_search` (read): name to email/phone via People API (contacts + other contacts); fuzzy "did you mean" on miss (`contact_not_found`).

## Smoke test
`USER_ID=<id> npx tsx --conditions=react-server lib/tools/google/smoke.ts` (the condition turns `server-only` into a no-op outside Next).
