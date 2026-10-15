import {
  Brain,
  CircleCheck,
  FileText,
  Folder,
  Globe,
  Laptop,
  Mail,
  Calendar,
  Sheet,
  Sparkles,
  User,
  Video,
  type LucideIcon,
} from "lucide-react";

export type ToolMeta = { icon: LucideIcon; color: string; label: string };

const META: Record<string, ToolMeta> = {
  gmail: { icon: Mail, color: "#0a84ff", label: "Gmail" },
  calendar: { icon: Calendar, color: "#ff3b30", label: "Calendar" },
  meet: { icon: Video, color: "#30b94d", label: "Meet" },
  drive: { icon: Folder, color: "#4285f4", label: "Drive" },
  docs: { icon: FileText, color: "#4285f4", label: "Docs" },
  sheets: { icon: Sheet, color: "#1e9e50", label: "Sheets" },
  tasks: { icon: CircleCheck, color: "#ff9f0a", label: "Tasks" },
  contacts: { icon: User, color: "#8e8e93", label: "Contacts" },
  memory: { icon: Brain, color: "#bf5af2", label: "Memory" },
  device: { icon: Laptop, color: "#64d2ff", label: "Mac" },
  web: { icon: Globe, color: "#32ade6", label: "Web" },
};

export function toolMeta(tool: string): ToolMeta {
  const prefix = tool.split("_")[0];
  return META[prefix] ?? { icon: Sparkles, color: "#5e5ce6", label: "Jarvis" };
}

const GERUND: Record<string, string> = {
  search: "Searching",
  list: "Listing",
  get: "Reading",
  read: "Reading",
  send: "Sending",
  create: "Creating",
  update: "Updating",
  delete: "Deleting",
  archive: "Archiving",
  label: "Labeling",
  unlabel: "Removing label from",
  find: "Finding",
  draft: "Drafting",
  reply: "Replying to",
  move: "Moving",
  add: "Adding",
  remove: "Removing",
  write: "Writing",
  append: "Appending to",
  complete: "Completing",
  trash: "Trashing",
  mark: "Marking",
  schedule: "Scheduling",
  check: "Checking",
  save: "Saving",
  remember: "Remembering",
  forget: "Forgetting",
  recall: "Recalling",
  summarize: "Summarizing",
  invite: "Inviting",
  share: "Sharing",
  export: "Exporting",
  watch: "Watching",
  batch: "Batch updating",
  modify: "Updating",
  insert: "Inserting",
  query: "Querying",
};

/** "gmail_send_email" -> "Sending email", "web_search" -> "Searching the web". */
export function toolTitle(tool: string): string {
  if (tool === "web_search") return "Searching the web";
  const words = tool.split("_");
  const rest = words.slice(1);
  if (rest.length === 0) return tool;
  const verb = rest[0];
  const noun = rest.slice(1).join(" ");
  const g = GERUND[verb];
  if (g) return noun ? `${g} ${noun}` : `${g} ${toolMeta(tool).label}`;
  return rest.join(" ").replace(/^./, (c) => c.toUpperCase());
}
