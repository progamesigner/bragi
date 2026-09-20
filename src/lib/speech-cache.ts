import { requestSpeech, type SpeechAudio, type SpeechRequest } from "./speech";

export function speechCacheKey(input: SpeechRequest): string {
  return JSON.stringify([input.text, input.toneHint ?? "", input.genreHint ?? ""]);
}

export class SpeechCache {
  readonly #entries = new Map<string, SpeechAudio>();
  #bytes = 0;

  constructor(
    readonly maxEntries = 3,
    readonly maxBytes = 9_000_000,
  ) {}

  get(input: SpeechRequest): SpeechAudio | undefined {
    const key = speechCacheKey(input);
    const value = this.#entries.get(key);
    if (!value) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(input: SpeechRequest, audio: SpeechAudio): void {
    const key = speechCacheKey(input);
    const existing = this.#entries.get(key);
    if (existing) {
      this.#bytes -= existing.blob.size;
      this.#entries.delete(key);
    }
    if (audio.blob.size > this.maxBytes || this.maxEntries < 1) return;

    while (
      this.#entries.size >= this.maxEntries ||
      (this.#entries.size > 0 && this.#bytes + audio.blob.size > this.maxBytes)
    ) {
      const oldest = this.#entries.keys().next().value;
      if (oldest === undefined) break;
      const removed = this.#entries.get(oldest);
      this.#entries.delete(oldest);
      this.#bytes -= removed?.blob.size ?? 0;
    }

    this.#entries.set(key, audio);
    this.#bytes += audio.blob.size;
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}

export const speechCache = new SpeechCache();

export async function requestCachedSpeech(
  input: SpeechRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SpeechAudio> {
  const cached = speechCache.get(input);
  if (cached) return cached;
  const audio = await requestSpeech(input, signal, fetcher);
  speechCache.set(input, audio);
  return audio;
}
