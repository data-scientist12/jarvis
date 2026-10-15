export type Automation = {
  id: string;
  name: string;
  trigger: unknown;
  instructions: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
};

export type Recipe = {
  id: string;
  name: string;
  description: string;
  icon: string;
  prompt: string;
  connectors: string[];
};
