"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/components/utils/api";

export type RecorderState = "idle" | "recording" | "transcribing";

function pickMime(): { mime: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  const candidates: [string, string][] = [
    ["audio/webm;codecs=opus", "webm"],
    ["audio/webm", "webm"],
    ["audio/mp4", "mp4"],
  ];
  for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  return { mime: "", ext: "webm" };
}

/**
 * Push-to-talk / click-to-record. Streams mic level (0..1) via an AnalyserNode while recording,
 * then POSTs multipart `audio` to /api/transcribe and returns the text via `onText`.
 */
export function useRecorder({ onText, onError }: { onText: (text: string) => void; onError?: (message: string) => void }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const res = useRef<{
    stream?: MediaStream;
    recorder?: MediaRecorder;
    ctx?: AudioContext;
    raf?: number;
    chunks: Blob[];
    ext: string;
    mime: string;
    cancelled?: boolean;
  }>({ chunks: [], ext: "webm", mime: "" });
  // Detect after mount so server and first client render match (avoids hydration mismatch).
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(!!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined");
  }, []);

  const cleanup = useCallback(() => {
    const r = res.current;
    if (r.raf) cancelAnimationFrame(r.raf);
    r.raf = undefined;
    r.stream?.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => {});
    r.stream = undefined;
    r.ctx = undefined;
    setLevel(0);
  }, []);

  useEffect(() => {
    const r = res.current;
    return () => {
      r.cancelled = true;
      if (r.recorder?.state === "recording") r.recorder.stop();
      cleanup();
    };
  }, [cleanup]);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { mime, ext } = pickMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const r = res.current;
      r.stream = stream;
      r.recorder = recorder;
      r.chunks = [];
      r.ext = ext;
      r.mime = recorder.mimeType || mime || "audio/webm";
      r.cancelled = false;

      // Live level via AnalyserNode.
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      r.ctx = ctx;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
        r.raf = requestAnimationFrame(tick);
      };
      r.raf = requestAnimationFrame(tick);

      recorder.ondataavailable = (e) => {
        if (e.data.size) r.chunks.push(e.data);
      };
      recorder.onstop = async () => {
        cleanup();
        if (r.cancelled) {
          setState("idle");
          return;
        }
        const blob = new Blob(r.chunks, { type: r.mime });
        if (blob.size < 800) {
          setState("idle");
          onError?.("That was too short. Hold the mic and speak.");
          return;
        }
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", blob, `audio.${r.ext}`);
          const out = await api<{ text?: string }>("/api/transcribe", { method: "POST", body: fd });
          const text = (out?.text ?? "").trim();
          if (text) onText(text);
          else onError?.("I couldn't hear anything. Try again.");
        } catch (e) {
          onError?.((e as Error).message || "Transcription failed.");
        } finally {
          setState("idle");
        }
      };
      recorder.start();
      setState("recording");
    } catch (e) {
      cleanup();
      setState("idle");
      const name = (e as DOMException)?.name;
      onError?.(name === "NotAllowedError" ? "Microphone access was blocked. Allow it in your browser settings." : "Couldn't start recording.");
    }
  }, [state, cleanup, onText, onError]);

  const stop = useCallback(() => {
    const rec = res.current.recorder;
    if (rec && rec.state === "recording") rec.stop();
  }, []);

  const cancel = useCallback(() => {
    res.current.cancelled = true;
    const rec = res.current.recorder;
    if (rec && rec.state === "recording") rec.stop();
    else cleanup();
  }, [cleanup]);

  return { state, level, supported, start, stop, cancel };
}
