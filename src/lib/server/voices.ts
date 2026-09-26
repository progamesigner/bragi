import "server-only";
import { requiredEnv } from "./config";

export function allowedVoices(): string[] {
  return [
    ...new Set(
      [process.env.GEMINI_TTS_VOICE ?? "", ...(process.env.GEMINI_TTS_VOICES ?? "").split(",")]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

export function resolveVoice(voice?: string): string {
  const voices = allowedVoices();
  const selected = voice ?? requiredEnv("GEMINI_TTS_VOICE");
  if (!selected || !voices.includes(selected)) throw new Error("Voice is not allowed");
  return selected;
}
