import { afterEach, expect, it, vi } from "vitest";
import { speechCache } from "../speech-cache";
import { AudioController, cachedSpeechAdapter } from "./controller";

afterEach(() => {
  speechCache.clear();
  vi.unstubAllGlobals();
});
it("isolates controller stop from a valid preload, aborting upstream only for the last caller", async () => {
  speechCache.clear();
  const signals: AbortSignal[] = [];
  const resolve: ((response: Response) => void)[] = [];
  const fetcher = vi.fn<typeof fetch>((_url, options) => {
    if (options?.signal) signals.push(options.signal);
    return new Promise((yes) => resolve.push(yes));
  });
  vi.stubGlobal("fetch", fetcher);
  const audio = {
    src: "",
    loop: false,
    playbackRate: 1,
    preservesPitch: false,
    currentTime: 0,
    paused: true,
    play() {
      return Promise.resolve();
    },
    pause() {},
    load() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLAudioElement;
  const context = {
    state: "running",
    resume: async () => {},
    close: async () => {},
    addEventListener() {},
    removeEventListener() {},
  } as unknown as AudioContext;
  const controller = new AudioController({
    speech: cachedSpeechAdapter,
    createAudio: () => audio,
    createContext: () => context,
    document: null,
    urls: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    settings: () => ({ rate: 1.5 }),
    subscribeSettings: () => () => {},
  });
  try {
    const input = { text: "shared controller" };
    const caller = new AbortController();
    const preload = controller.preload({ segmentKey: "a", input, signal: caller.signal });
    const play = controller.play({ owner: "main", segmentKey: "a", input });
    controller.stop("main");
    await play;
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);
    resolve[0]?.(new Response(new Blob([new Uint8Array(10)], { type: "audio/wav" })));
    await preload;
    expect(controller.isPrepared({ segmentKey: "a", input })).toBe(true);

    const second = new AbortController();
    const pending = controller
      .preload({ segmentKey: "b", input: { text: "cancel both" }, signal: second.signal })
      .catch((error) => error);
    const playing = controller.play({
      owner: "review",
      segmentKey: "b",
      input: { text: "cancel both" },
    });
    second.abort();
    expect(signals[1]?.aborted).toBe(false);
    controller.stop("review");
    await playing;
    expect(signals[1]?.aborted).toBe(true);
    expect((await pending).name).toBe("AbortError");
    resolve[1]?.(new Response(new Blob([new Uint8Array(10)], { type: "audio/wav" })));
  } finally {
    controller.dispose();
  }
});
