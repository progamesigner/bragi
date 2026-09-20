import { apiErrorMessage } from "./api";

export type SpeechRequest = {
  text: string;
  toneHint?: string;
  genreHint?: string;
};

export type SpeechAudio = {
  blob: Blob;
  durationMs?: number;
};

export async function requestSpeech(
  input: SpeechRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SpeechAudio> {
  const response = await fetcher("/api/tts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Speech request failed"));

  const blob = await response.blob();
  if (blob.type !== "audio/wav") throw new Error("Speech service returned invalid audio");

  const durationMs = Number(response.headers.get("x-audio-duration-ms"));
  return {
    blob,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
  };
}
