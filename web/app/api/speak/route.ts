import { z } from "zod";
import { openai } from "@/lib/agent/openai";
import { generateSpeech } from "ai";
import { authed, jsonError, readJson } from "@/lib/security/http";
import { enforce, LIMITS } from "@/lib/security/ratelimit";

export const maxDuration = 60;

const bodySchema = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const limited = await enforce(user.id, [LIMITS.speak]);
  if (limited) return limited;
  const body = await readJson(req, bodySchema);
  if (body instanceof Response) return body;

  try {
    const { audio } = await generateSpeech({
      model: openai.speech(process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"),
      text: body.text,
      voice: "alloy",
      outputFormat: "mp3",
      instructions: "Speak in a calm, warm, concise assistant voice.",
      abortSignal: AbortSignal.timeout(45_000),
    });
    return new Response(audio.uint8Array as BodyInit, {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "content-length": String(audio.uint8Array.byteLength) },
    });
  } catch (e) {
    console.warn("[speak] failed:", e instanceof Error ? e.message : e);
    return jsonError(502, "speech_failed");
  }
}
