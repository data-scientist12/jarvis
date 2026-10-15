import { openai } from "@/lib/agent/openai";

export const ALLOWED_MODELS = ["gpt-5.4-mini", "gpt-5.5"] as const;

export function executorModelId(userModel?: string | null): string {
  if (userModel && (ALLOWED_MODELS as readonly string[]).includes(userModel)) return userModel;
  return process.env.OPENAI_MODEL || "gpt-5.4-mini";
}

export function reviewModelId(): string {
  return process.env.OPENAI_MODEL_REVIEW || "gpt-5.5";
}

export const executorModel = (id: string) => openai.responses(id);
export const reviewModel = () => openai.responses(reviewModelId());

/** Low reasoning effort keeps the tool loop fast. */
export const lowEffort = { openai: { reasoningEffort: "low" } } as const;
