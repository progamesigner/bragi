import { describe, expect, it } from "vitest";
import type { SpeechAudio, SpeechRequest } from "./speech";
import { requestCachedSpeech, SpeechCache, speechCache, speechCacheKey } from "./speech-cache";

function request(text: string): SpeechRequest {
  return { text, toneHint: "平靜", genreHint: "奇幻" };
}

function audio(size: number): SpeechAudio {
  return { blob: new Blob([new Uint8Array(size)], { type: "audio/wav" }), durationMs: size };
}

describe("speech cache", () => {
  it("does not repopulate the cache with a response from a cleared workspace", async () => {
    speechCache.clear();
    let resolveResponse!: (response: Response) => void;
    const fetcher: typeof fetch = () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      });
    const old = requestCachedSpeech(request("old workspace"), undefined, fetcher);
    speechCache.clear();
    resolveResponse(new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } }));
    await old;
    expect(speechCache.get(request("old workspace"))).toBeUndefined();
  });

  it("discards a late response when its request was aborted", async () => {
    speechCache.clear();
    const controller = new AbortController();
    let resolveResponse!: (response: Response) => void;
    const fetcher: typeof fetch = () =>
      new Promise((resolve) => {
        resolveResponse = resolve;
      });
    const pending = requestCachedSpeech(request("cancelled"), controller.signal, fetcher);
    controller.abort();
    resolveResponse(new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } }));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(speechCache.get(request("cancelled"))).toBeUndefined();
  });
  it("keys audio by every synthesis input", () => {
    expect(speechCacheKey(request("第一段"))).not.toBe(
      speechCacheKey({ ...request("第一段"), toneHint: "緊張" }),
    );
  });

  it("evicts the least recently used entry", () => {
    const cache = new SpeechCache(2, 100);
    cache.set(request("one"), audio(10));
    cache.set(request("two"), audio(10));
    cache.get(request("one"));
    cache.set(request("three"), audio(10));

    expect(cache.get(request("one"))).toBeDefined();
    expect(cache.get(request("two"))).toBeUndefined();
    expect(cache.get(request("three"))).toBeDefined();
  });

  it("bounds retained audio by bytes and can be cleared", () => {
    const cache = new SpeechCache(3, 15);
    cache.set(request("one"), audio(10));
    cache.set(request("two"), audio(10));

    expect(cache.get(request("one"))).toBeUndefined();
    expect(cache.get(request("two"))).toBeDefined();
    cache.clear();
    expect(cache.get(request("two"))).toBeUndefined();
  });

  it("reuses a cached API response", async () => {
    speechCache.clear();
    const fetcher = async () =>
      new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } });
    let calls = 0;
    const countedFetch: typeof fetch = (..._arguments) => {
      calls += 1;
      return fetcher();
    };

    await requestCachedSpeech(request("one"), undefined, countedFetch);
    await requestCachedSpeech(request("one"), undefined, countedFetch);

    expect(calls).toBe(1);
    speechCache.clear();
  });

  it("deduplicates concurrent synthesis requests", async () => {
    speechCache.clear();
    let resolveResponse!: (response: Response) => void;
    let calls = 0;
    const fetcher: typeof fetch = () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    };

    const first = requestCachedSpeech(request("shared"), undefined, fetcher);
    const second = requestCachedSpeech(request("shared"), undefined, fetcher);
    expect(calls).toBe(1);
    resolveResponse(new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } }));

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    speechCache.clear();
  });

  it("keeps a shared request alive when only one caller cancels", async () => {
    speechCache.clear();
    let resolveResponse!: (response: Response) => void;
    const signals: AbortSignal[] = [];
    const fetcher: typeof fetch = (_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    };
    const prefetch = new AbortController();
    const first = requestCachedSpeech(request("shared cancel"), prefetch.signal, fetcher);
    const second = requestCachedSpeech(
      request("shared cancel"),
      new AbortController().signal,
      fetcher,
    );

    prefetch.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    resolveResponse(new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } }));
    await expect(second).resolves.toMatchObject({ blob: expect.any(Blob) });
    expect(speechCache.get(request("shared cancel"))).toBeDefined();
    speechCache.clear();
  });

  it("cancels upstream only after every caller leaves and then starts fresh", async () => {
    speechCache.clear();
    const signals: AbortSignal[] = [];
    const resolvers: ((response: Response) => void)[] = [];
    const fetcher: typeof fetch = (_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    };
    const callers = [new AbortController(), new AbortController()];
    const requests = callers.map((caller) =>
      requestCachedSpeech(request("all cancel"), caller.signal, fetcher),
    );

    callers[0]?.abort();
    expect(signals[0]?.aborted).toBe(false);
    callers[1]?.abort();
    expect(signals[0]?.aborted).toBe(true);
    await Promise.all(requests.map((pending) => expect(pending).rejects.toThrow()));

    const retry = requestCachedSpeech(request("all cancel"), undefined, fetcher);
    expect(signals).toHaveLength(2);
    // A late answer from the cancelled request must neither fill the cache nor end the retry.
    resolvers[0]?.(new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } }));
    await Promise.resolve();
    expect(speechCache.get(request("all cancel"))).toBeUndefined();
    resolvers[1]?.(new Response(audio(12).blob, { headers: { "content-type": "audio/wav" } }));
    await expect(retry).resolves.toMatchObject({ blob: expect.any(Blob) });
    expect(speechCache.get(request("all cancel"))?.blob.size).toBe(12);
    speechCache.clear();
  });

  it("does not let a caller without a signal be cancelled by others", async () => {
    speechCache.clear();
    let resolveResponse!: (response: Response) => void;
    const signals: AbortSignal[] = [];
    const fetcher: typeof fetch = (_url, init) => {
      if (init?.signal) signals.push(init.signal);
      return new Promise((resolve) => {
        resolveResponse = resolve;
      });
    };
    const caller = new AbortController();
    const cancelled = requestCachedSpeech(request("unsignalled"), caller.signal, fetcher);
    const kept = requestCachedSpeech(request("unsignalled"), undefined, fetcher);
    caller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    expect(signals[0]?.aborted).toBe(false);
    resolveResponse(new Response(audio(10).blob, { headers: { "content-type": "audio/wav" } }));
    await expect(kept).resolves.toBeDefined();
    speechCache.clear();
  });
});
