import "server-only";
import { DEFAULT_VOICE, VOICE_CATALOG } from "../voices";

const catalog = new Set<string>(VOICE_CATALOG.map(([name]) => name));

/** Every prebuilt voice, with the default first so the picker can label it. */
export function allowedVoices(): string[] {
  return [DEFAULT_VOICE, ...[...catalog].filter((voice) => voice !== DEFAULT_VOICE)];
}

export function resolveVoice(voice?: string): string {
  const selected = voice ?? DEFAULT_VOICE;
  if (!catalog.has(selected)) throw new Error("Voice is not allowed");
  return selected;
}
