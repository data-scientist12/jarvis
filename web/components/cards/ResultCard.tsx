"use client";

import type { Card } from "@/lib/tools/types";
import { EmailCard, EmailListCard } from "./EmailCards";
import { EventCard, EventListCard } from "./EventCards";
import { DocCard, FileListCard } from "./FileCards";
import { BulkCard, ContactCard, MeetCard, NoteCard } from "./MiscCards";
import { TaskCard, TaskListCard } from "./TaskCards";

/** Renders a `ToolResult.card` payload. Unknown card types are ignored. */
export function ResultCard({ card }: { card: Card }) {
  switch (card.type) {
    case "event":
      return <EventCard card={card} />;
    case "event_list":
      return <EventListCard card={card} />;
    case "email":
      return <EmailCard card={card} />;
    case "email_list":
      return <EmailListCard card={card} />;
    case "doc":
      return <DocCard card={card} />;
    case "file_list":
      return <FileListCard card={card} />;
    case "task":
      return <TaskCard card={card} />;
    case "task_list":
      return <TaskListCard card={card} />;
    case "contact":
      return <ContactCard card={card} />;
    case "meet":
      return <MeetCard card={card} />;
    case "bulk":
      return <BulkCard card={card} />;
    case "note":
      return <NoteCard card={card} />;
    default:
      return null;
  }
}
