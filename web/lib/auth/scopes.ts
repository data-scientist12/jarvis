/** Google OAuth scopes Jarvis requests, grouped by connector. */
export const GOOGLE_SCOPES = {
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  calendar: ["https://www.googleapis.com/auth/calendar"],
  meet: ["https://www.googleapis.com/auth/meetings.space.created"],
  drive: ["https://www.googleapis.com/auth/drive"],
  tasks: ["https://www.googleapis.com/auth/tasks"],
  contacts: [
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
  ],
} as const;

export type Connector = keyof typeof GOOGLE_SCOPES;

export const CONNECTORS: { id: Connector; name: string; description: string }[] = [
  { id: "gmail", name: "Gmail", description: "Read, triage, draft and send email" },
  { id: "calendar", name: "Google Calendar", description: "Schedule, reschedule and find free time" },
  { id: "meet", name: "Google Meet", description: "Create instant meeting rooms" },
  { id: "drive", name: "Drive, Docs & Sheets", description: "Find files, write docs, log to sheets" },
  { id: "tasks", name: "Google Tasks", description: "To-dos that sync to your phone" },
  { id: "contacts", name: "Contacts", description: "Resolve people to emails" },
];

export const ALL_GOOGLE_SCOPES: string[] = Object.values(GOOGLE_SCOPES).flat();

/** Which connectors are covered by a space- or comma-separated granted scope string. */
export function grantedConnectors(scope: string | null | undefined): Connector[] {
  const granted = new Set((scope ?? "").split(/[\s,]+/).filter(Boolean));
  return (Object.keys(GOOGLE_SCOPES) as Connector[]).filter((c) =>
    GOOGLE_SCOPES[c].every((s) => granted.has(s)),
  );
}
