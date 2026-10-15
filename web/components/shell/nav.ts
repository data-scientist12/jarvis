import { Activity, House, Plug, Settings, Zap, type LucideIcon } from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: House },
  { href: "/automations", label: "Automations", icon: Zap },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/connectors", label: "Connectors", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings },
];

export type ConversationSummary = { id: string; title: string; updatedAt: string };
