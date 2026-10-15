export type Brief = {
  greeting: string;
  summary: string;
  connected: boolean;
  events: { id: string; title: string; start: string; end: string; meetLink?: string; htmlLink?: string }[];
  emails: { id: string; threadId: string; from: string; subject: string; snippet: string; date: string; unread: boolean }[];
  tasks: { id: string; title: string; due?: string }[];
  generatedAt: string;
};

export type Stats = {
  tasksCompletedToday: number;
  tasksCompletedWeek: number;
  actionsVerifiedWeek: number;
  minutesSavedWeek: number;
  automationsActive: number;
};
