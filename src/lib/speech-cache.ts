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

type PendingSpeech = {
  promise: Promise<SpeechAudio>;
  controller: AbortController;
  subscribers: number;
};
const pendingSpeech = new Map<string, PendingSpeech>();

function abortError(): DOMException {
  return new DOMException("Speech request was cancelled", "AbortError");
}

/**
 * Waits for a shared synthesis request on behalf of one caller. Aborting the caller's signal
 * rejects only that caller; the upstream request is cancelled once every caller has left.
 */
function subscribe(key: string, pending: PendingSpeech, signal?: AbortSignal) {
  pending.subscribers += 1;
  return new Promise<SpeechAudio>((resolve, reject) => {
    let active = true;
    const leave = () => {
      if (!active) return false;
      active = false;
      signal?.removeEventListener("abort", cancel);
      pending.subscribers -= 1;
      return true;
    };
    function cancel() {
      if (!leave()) return;
      reject(abortError());
      if (pending.subscribers > 0) return;
      pending.controller.abort();
      if (pendingSpeech.get(key) === pending) pendingSpeech.delete(key);
    }
    signal?.addEventListener("abort", cancel, { once: true });
    pending.promise.then(
      (audio) => leave() && resolve(audio),
      (error) => leave() && reject(error),
    );
  });
}

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
  const revision = speechCache.revision;
  const key = `${revision}:${speechCacheKey(input)}`;
  const pending = pendingSpeech.get(key);
  if (pending) {
    console.info(JSON.stringify({ event: "bragi.audio-cache", result: "pending", purpose }));
    return subscribe(key, pending, signal);
  }

  console.info(JSON.stringify({ event: "bragi.audio-cache", result: "miss", purpose }));
  const controller = new AbortController();
  const entry: PendingSpeech = {
    controller,
    subscribers: 0,
    promise: requestSpeech(input, controller.signal, fetcher, purpose)
      .then((audio) => {
        controller.signal.throwIfAborted();
        if (speechCache.revision === revision) speechCache.set(input, audio);
        return audio;
      })
      .finally(() => {
        if (pendingSpeech.get(key) === entry) pendingSpeech.delete(key);
      }),
  };
  pendingSpeech.set(key, entry);
  return subscribe(key, entry, signal);
}
