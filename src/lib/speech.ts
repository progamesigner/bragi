import { readApiError } from "./api";
import { t } from "./i18n";
import { requireOnline } from "./network";

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
