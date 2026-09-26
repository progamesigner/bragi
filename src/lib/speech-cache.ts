import { requestSpeech, type SpeechAudio, type SpeechPurpose, type SpeechRequest } from "./speech";

export function speechCacheKey(input: SpeechRequest): string {
  return JSON.stringify([
    input.text,
    input.toneHint ?? "",
    input.genreHint ?? "",
    input.voice ?? "",
  ]);
}

export class SpeechCache {
  readonly #entries = new Map<string, SpeechAudio>();
  #bytes = 0;
  #revision = 0;

  get revision(): number {
    return this.#revision;
  }

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
    this.#revision += 1;
    this.#entries.clear();
    this.#bytes = 0;
  }
}

export const speechCache = new SpeechCache();
const pendingSpeech = new Map<string, { promise: Promise<SpeechAudio>; signal?: AbortSignal }>();

export async function requestCachedSpeech(
  input: SpeechRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
  purpose: SpeechPurpose = "preview",
): Promise<SpeechAudio> {
  signal?.throwIfAborted();
  const cached = speechCache.get(input);
  if (cached) {
    console.info(JSON.stringify({ event: "bragi.audio-cache", result: "hit", purpose }));
    return cached;
  }
  signal?.throwIfAborted();
  const revision = speechCache.revision;
  const key = `${revision}:${speechCacheKey(input)}`;
  const pending = pendingSpeech.get(key);
  if (pending && !pending.signal?.aborted) {
    console.info(JSON.stringify({ event: "bragi.audio-cache", result: "pending", purpose }));
    const audio = await pending.promise;
    signal?.throwIfAborted();
    return audio;
  }

  console.info(JSON.stringify({ event: "bragi.audio-cache", result: "miss", purpose }));
  const request = requestSpeech(input, signal, fetcher, purpose)
    .then((audio) => {
      signal?.throwIfAborted();
      if (speechCache.revision === revision) speechCache.set(input, audio);
      return audio;
    })
    .finally(() => {
      if (pendingSpeech.get(key)?.promise === request) pendingSpeech.delete(key);
    });
  pendingSpeech.set(key, { promise: request, signal });
  return request;
}
