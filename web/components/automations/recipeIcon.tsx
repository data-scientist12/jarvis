import {
  Archive,
  BellRing,
  Calendar,
  CalendarClock,
  FileText,
  ListTodo,
  Mail,
  Newspaper,
  Repeat,
  Sparkles,
  Sun,
  Timer,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toolMeta } from "@/components/timeline/toolMeta";

const ICONS: Record<string, LucideIcon> = {
  mail: Mail,
  email: Mail,
  inbox: Archive,
  archive: Archive,
  newspaper: Newspaper,
  newsletter: Newspaper,
  calendar: Calendar,
  calendarclock: CalendarClock,
  clock: Timer,
  timer: Timer,
  sun: Sun,
  sunrise: Sun,
  bell: BellRing,
  bellring: BellRing,
  reply: Repeat,
  repeat: Repeat,
  filetext: FileText,
  file: FileText,
  doc: FileText,
  listtodo: ListTodo,
  tasks: ListTodo,
  checksquare: ListTodo,
  users: Users,
  contacts: Users,
  zap: Zap,
  sparkles: Sparkles,
};

/** Recipes name a lucide-ish icon; fall back to the first connector's icon. */
export function recipeIcon(icon: string, connectors: string[] = []): { Icon: LucideIcon; color: string } {
  const key = (icon ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const meta = toolMeta(connectors[0] ?? "");
  return { Icon: ICONS[key] ?? (connectors[0] ? meta.icon : Sparkles), color: meta.color };
}
