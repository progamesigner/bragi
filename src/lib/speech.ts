import { readApiError } from "./api";
import { t } from "./i18n";
import { requireOnline } from "./network";
import { voiceSampleAsset } from "./voice-samples";

export type SpeechRequest = {
  voice?: string;
  text: string;
  toneHint?: string;
  genreHint?: string;
};

export type SpeechAudio = {
  blob: Blob;
  durationMs?: number;
};

export type SpeechPurpose = "preview" | "playback" | "prefetch";

export async function requestSpeech(
  input: SpeechRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  purpose: SpeechPurpose = "preview",
): Promise<SpeechAudio> {
  requireOnline();
  const response = await fetcher("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bragi-speech-purpose": purpose },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await readApiError(response, t("apiError.speechFailed"));

  const blob = await response.blob();
  if (blob.type !== "audio/wav") throw new Error(t("apiError.invalidAudio"));

  const durationMs = Number(response.headers.get("x-audio-duration-ms"));
  return {
    blob,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
  };
}

/**
 * Voice previews of a sample line come from the pre-generated file; anything else, or a voice
 * without one yet, is synthesized live.
 */
export async function requestVoiceSample(
  input: SpeechRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SpeechAudio> {
  const asset = voiceSampleAsset(input);
  if (asset) {
    requireOnline();
    const response = await fetcher(asset, { signal });
    if (response.ok && response.headers.get("content-type")?.startsWith("audio/"))
      return { blob: await response.blob() };
  }
  return requestSpeech(input, signal, fetcher);
}
