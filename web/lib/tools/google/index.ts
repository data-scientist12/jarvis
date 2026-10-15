import type { JarvisTool } from "@/lib/tools/types";
import { gmailTools } from "./gmail";
import { calendarTools } from "./calendar";
import { meetTools } from "./meet";
import { driveTools } from "./drive";
import { docsTools } from "./docs";
import { sheetsTools } from "./sheets";
import { tasksTools } from "./tasks";
import { contactsTools } from "./contacts";

/** All Google connector tools (Gmail, Calendar, Meet, Drive/Docs/Sheets, Tasks, Contacts). */
export const googleTools: JarvisTool[] = [
  ...gmailTools,
  ...calendarTools,
  ...meetTools,
  ...driveTools,
  ...docsTools,
  ...sheetsTools,
  ...tasksTools,
  ...contactsTools,
];
