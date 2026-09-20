import { describe, expect, it } from "vitest";
import type { SpeechAudio, SpeechRequest } from "./speech";
import { SpeechCache, speechCacheKey } from "./speech-cache";

function request(text: string): SpeechRequest {
  return { text, toneHint: "平靜", genreHint: "奇幻" };
}

function audio(size: number): SpeechAudio {
  return { blob: new Blob([new Uint8Array(size)], { type: "audio/wav" }), durationMs: size };
}

describe("speech cache", () => {
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
});
