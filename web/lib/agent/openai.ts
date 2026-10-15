import { createOpenAI } from "@ai-sdk/openai";

/**
 * API keys pasted into a terminal sometimes carry ANSI escape codes or stray punctuation
 * (e.g. "\u001b[C" from arrow keys). Real OpenAI keys only contain [A-Za-z0-9_-].
 */
export function cleanApiKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/[^A-Za-z0-9_-]/g, "");
  return cleaned || undefined;
}

export const openai = createOpenAI({ apiKey: cleanApiKey(process.env.OPENAI_API_KEY) });
