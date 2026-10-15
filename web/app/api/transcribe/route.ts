import { openai } from "@/lib/agent/openai";
import { transcribe } from "ai";
import { authed, json, jsonError } from "@/lib/security/http";
import { enforce, LIMITS } from "@/lib/security/ratelimit";

export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const user = await authed();
  if (user instanceof Response) return user;
  const limited = await enforce(user.id, [LIMITS.transcribe]);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid_form");
  }
  const file = form.get("audio");
  if (!(file instanceof File)) return jsonError(400, "missing_audio");
  if (file.size === 0) return jsonError(400, "empty_audio");
  if (file.size > MAX_BYTES) return jsonError(413, "audio_too_large");
  if (file.type && !/^(audio|video)\//.test(file.type)) return jsonError(415, "unsupported_media_type");

  try {
    const { text } = await transcribe({
      model: openai.transcription(process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe"),
      audio: new Uint8Array(await file.arrayBuffer()),
      abortSignal: AbortSignal.timeout(45_000),
    });
    return json({ text: text.trim() });
  } catch (e) {
    console.warn("[transcribe] failed:", e instanceof Error ? e.message : e);
    return jsonError(502, "transcription_failed");
  }
}
