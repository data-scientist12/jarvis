export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** lucide-react icon name (PascalCase). */
  icon: string;
  /** Plain-English request that is sent to POST /api/automations to create the automation. */
  prompt: string;
  /** Connector ids this recipe needs. */
  connectors: string[];
  /** Human-readable cadence, e.g. "Weekdays 8:00". */
  schedule: string;
}

export const RECIPES: Recipe[] = [
  {
    id: "morning-brief",
    name: "Morning brief to inbox",
    description: "Every weekday at 8:00, email yourself today's meetings, key emails and due tasks.",
    icon: "Sunrise",
    schedule: "Weekdays 8:00",
    connectors: ["gmail", "calendar", "tasks"],
    prompt:
      "Every weekday at 8:00 AM, send me a morning brief by email. Look at today's calendar events (with times and Meet links), my unread important emails from the last 2 days (skip promotions and social), and Google Tasks due today or overdue. Write a warm, scannable email to myself with the subject 'Your day: <weekday, date>' with sections for Meetings, Emails that need a reply, and Tasks, followed by one sentence suggesting what to tackle first.",
  },
  {
    id: "inbox-zero",
    name: "Inbox zero",
    description: "Daily at 18:00, archive old newsletters and promotions and star what matters.",
    icon: "Inbox",
    schedule: "Daily 18:00",
    connectors: ["gmail"],
    prompt:
      "Every day at 6:00 PM, clean up my inbox. Archive newsletters and promotional emails in my inbox older than 2 days (search with Gmail like 'in:inbox older_than:2d (category:promotions OR category:updates OR category:social)'), using bulk actions. Star emails from real people that look important or need a reply (unread, in the inbox, not promotions). Never delete anything and never touch emails newer than 2 days unless they are clearly important. Finish with a short summary of how many emails were archived and starred.",
  },
  {
    id: "follow-up-nudger",
    name: "Follow-up nudger",
    description: "Finds sent emails with no reply after 3 days, drafts polite nudges, and sends you a summary.",
    icon: "BellRing",
    schedule: "Daily 10:00",
    connectors: ["gmail"],
    prompt:
      "Every day at 10:00 AM, find emails I sent to other people between 3 and 14 days ago that never got a reply (search sent mail, then check each thread for replies from anyone else). For each one, create a Gmail DRAFT (do not send) replying in the same thread with a short, friendly nudge in my voice. Then email me a summary listing each draft with the recipient, subject and how many days it has been waiting. If there is nothing to follow up on, do not send anything.",
  },
  {
    id: "invoice-catcher",
    name: "Invoice catcher",
    description: "Every 30 minutes, file invoice and receipt attachments in Drive and log them in an Expenses sheet.",
    icon: "ReceiptText",
    schedule: "Every 30 min",
    connectors: ["gmail", "drive"],
    prompt:
      "Every 30 minutes, check Gmail for new emails that look like invoices or receipts (query: '(invoice OR receipt OR \"payment confirmation\" OR \"your order\") has:attachment newer_than:1d'). For each new one, save the attachment into a Google Drive folder called 'Invoices' (create it if it does not exist), then append a row to a Google Sheet called 'Expenses' (create it with the columns Date, Vendor, Amount, Currency, Invoice link, Email subject if it does not exist) with the details you can read from the email. Skip emails you have already logged (check the sheet for the Drive link or email subject). Report what was filed.",
  },
  {
    id: "meeting-prep",
    name: "Meeting prep",
    description: "Weekdays at 8:30, build a prep doc for each meeting with external attendees.",
    icon: "NotebookPen",
    schedule: "Weekdays 8:30",
    connectors: ["calendar", "gmail", "drive"],
    prompt:
      "Every weekday at 8:30 AM, look at today's calendar. For each meeting that includes attendees outside my own email domain, create a Google Doc titled 'Prep: <meeting title> (<date>)' containing: who is attending, a summary of the most recent email threads with those people (use Gmail search), open questions or commitments from those threads, and a proposed 3-bullet agenda. Skip meetings that already have a prep doc today. Finish with a list of the docs created with links.",
  },
  {
    id: "weekly-review",
    name: "Weekly review",
    description: "Fridays at 17:00, a Doc summarizing your week, emailed to you.",
    icon: "CalendarCheck",
    schedule: "Fri 17:00",
    connectors: ["calendar", "gmail", "tasks", "drive"],
    prompt:
      "Every Friday at 5:00 PM, write my weekly review. Collect this week's (Monday to today) calendar meetings, emails I sent, and Google Tasks I completed. Create a Google Doc titled 'Weekly review: <week of date>' with sections for Meetings, Sent emails worth remembering, Tasks completed, Loose ends carried over, and Focus for next week. Then email me a short summary with the link to the Doc.",
  },
  {
    id: "focus-time-guard",
    name: "Focus time guard",
    description: "Sundays at 20:00, block two hours of focus time on each weekday of the coming week.",
    icon: "Shield",
    schedule: "Sun 20:00",
    connectors: ["calendar"],
    prompt:
      "Every Sunday at 8:00 PM, protect my focus time for the coming week. For each weekday (Monday to Friday) next week, find a free 2-hour slot between 9:00 AM and 5:00 PM (prefer mornings) and create a calendar event named 'Focus time' with no attendees. Skip any day that already has a 'Focus time' event or has no free 2-hour slot. Report which days got a block.",
  },
  {
    id: "email-action-items",
    name: "Action items from email",
    description: "Hourly, turn emails that ask you to do something into Google Tasks.",
    icon: "ListTodo",
    schedule: "Hourly",
    connectors: ["gmail", "tasks"],
    prompt:
      "Every hour, scan my recent unread inbox emails from real people (query: 'in:inbox newer_than:1d -category:promotions -category:social -category:updates'). For each email that clearly asks me to do something (a request, a deadline, a question I must answer), create a Google Task with a clear action title, the sender and subject in the notes, and a due date if the email states or implies one. Do not create duplicates: check existing open tasks first. Report the tasks created.",
  },
];
