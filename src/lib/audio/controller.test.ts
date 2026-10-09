import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeechAudio } from "../speech";
import { SpeechCache } from "../speech-cache";
import {
  AudioController,
  type AudioControllerOptions,
  type AudioSnapshot,
  type SpeechAdapter,
} from "./controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}
class FakeAudio extends EventTarget {
  src = "";
  loop = false;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = 4;
  playbackRate = 1;
  preservesPitch = false;
  playResult: (() => Promise<void>) | undefined;
  plays: { src: string; rate: number }[] = [];
  play = vi.fn(() => {
    this.paused = false;
    this.ended = false;
    this.plays.push({ src: this.src, rate: this.playbackRate });
    return this.playResult?.() ?? Promise.resolve();
  });
  pause = vi.fn(() => {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  });
  load() {
    this.playbackRate = 1;
    this.currentTime = 0;
    this.ended = false;
  }
  removeAttribute() {
    this.src = "";
  }
  metadata() {
    this.dispatchEvent(new Event("loadedmetadata"));
  }
  end() {
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event("ended"));
  }
}
class FakeSource extends EventTarget {
  buffer?: { duration: number };
  stopped = false;
  startTime = 0;
  connect() {}
  disconnect() {}
  start(time: number) {
    this.startTime = time;
  }
  stop() {
    this.stopped = true;
    this.end();
  }
  end() {
    this.dispatchEvent(new Event("ended"));
  }
}
class FakeContext extends EventTarget {
  state: string = "running";
  destination = {};
  base = 0;
  since = Date.now();
  sources: FakeSource[] = [];
  resumeResult: (() => Promise<void>) | undefined;
  get currentTime() {
    return this.base + (this.state === "running" ? (Date.now() - this.since) / 1000 : 0);
  }
  change(state: string) {
    this.base = this.currentTime;
    this.since = Date.now();
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
  resume = vi.fn(() => {
    if (this.resumeResult) return this.resumeResult();
    this.change("running");
    return Promise.resolve();
  });
  suspend = vi.fn(() => {
    this.change("suspended");
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.change("closed");
    return Promise.resolve();
  });
  createBuffer(_channels: number, samples: number, sampleRate: number) {
    return { duration: samples / sampleRate, copyToChannel() {} };
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}
const asset: SpeechAudio = {
  blob: new Blob([new Uint8Array(10)], { type: "audio/wav" }),
  durationMs: 4000,
};
const request = { owner: "main" as const, segmentKey: "a:v1", input: { text: "first" }, rate: 1 };
const controllers: AudioController[] = [];
function setup(overrides: Partial<AudioControllerOptions> = {}) {
  const cache = new SpeechCache();
  const audio = new FakeAudio();
  const context = new FakeContext();
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      stream = c;
    },
    cancel: cancelled,
  });
  const speech: SpeechAdapter = {
    get: (input) => cache.get(input),
    set: (input, audio) => cache.set(input, audio),
    request: vi.fn(async (input) => {
      cache.set(input, asset);
      return asset;
    }),
    stream: vi.fn(async () => ({ reader: readable.getReader(), sampleRate: 24_000 })),
    revision: () => cache.revision,
  };
  let settings = { voice: "A", rate: 1 };
  let changed = () => {};
  const urls = { createObjectURL: vi.fn(() => `blob:${Math.random()}`), revokeObjectURL: vi.fn() };
  const doc = new EventTarget() as Document;
  Object.defineProperty(doc, "visibilityState", { value: "visible", writable: true });
  const controller = new AudioController({
    speech,
    createAudio: () => audio as unknown as HTMLAudioElement,
    createContext: () => context as unknown as AudioContext,
    urls,
    document: doc,
    settings: () => settings,
    subscribeSettings: (listener) => {
      changed = listener;
      return vi.fn();
    },
    timeoutMs: 100,
    ...overrides,
  });
  controllers.push(controller);
  const states: AudioSnapshot[] = [];
  controller.subscribe((state) => states.push(state));
  return {
    controller,
    cache,
    audio,
    context,
    stream,
    speech,
    states,
    cancelled,
    urls,
    doc,
    settings(value: typeof settings) {
      settings = value;
      changed();
    },
  };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.useRealTimers();
});

describe("audio controller", () => {
  it.each(["cached", "prefetched", "rate"])(
    "confirms the %s WAV path after native content play",
    async (path) => {
      const s = setup();
      if (path === "cached") s.cache.set({ text: "first", voice: "A" }, asset);
      if (path === "prefetched") await s.controller.preload(request);
      const started = deferred<void>();
      s.audio.playResult = () => (s.audio.loop ? Promise.resolve() : started.promise);
      const work = s.controller.play({ ...request, rate: path === "rate" ? 1.5 : 1 });
      expect(s.context.resume).toHaveBeenCalledTimes(1);
      expect(s.audio.play).toHaveBeenCalledTimes(1);
      expect(s.controller.snapshot.phase).toBe("loading");
      await flush();
      expect(s.controller.snapshot.phase).toBe("loading");
      expect(s.audio.plays.at(-1)?.rate).toBe(path === "rate" ? 1.5 : 1);
      started.resolve();
      await work;
      expect(s.controller.snapshot.phase).toBe("playing");
      expect(s.audio.preservesPitch).toBe(true);
      expect(s.speech.stream).not.toHaveBeenCalled();
      expect(s.speech.request).toHaveBeenCalledTimes(path === "cached" ? 0 : 1);
      expect([...new Set(s.states.map((state) => state.phase))]).toEqual([
        "idle",
        "loading",
        "playing",
      ]);
    },
  );

  it("confirms PCM at actual schedule start; EOF enables seek without ending or handoff", async () => {
    const s = setup();
    const work = s.controller.play(request);
    await flush();
    s.stream.enqueue(new Uint8Array(48_000));
    await flush();
    expect(s.controller.snapshot.phase).toBe("loading");
    expect(s.controller.snapshot.seekable).toBe(false);
    await s.controller.seek("main", 0.5);
    expect(s.controller.snapshot.transport).toBe("pcm");
    await vi.advanceTimersByTimeAsync(81);
    expect(s.controller.snapshot.phase).toBe("playing");
    expect(s.controller.snapshot.position).toBeCloseTo(0.001);
    s.stream.close();
    await work;
    s.audio.metadata();
    expect(s.controller.snapshot).toMatchObject({
      phase: "playing",
      transport: "pcm",
      seekable: true,
    });
    expect(s.audio.plays).toHaveLength(1); // Only the silent prime.
    await s.controller.seek("main", 0.5);
    expect(s.context.sources.every((source) => source.stopped)).toBe(true);
    expect(s.controller.snapshot).toMatchObject({
      phase: "playing",
      transport: "wav",
      position: 0.5,
      activeOutputs: 1,
    });
    s.audio.end();
    expect(s.controller.snapshot.phase).toBe("ended");
  });

  it("ends PCM only when the final source ends", async () => {
    const s = setup();
    const work = s.controller.play(request);
    await flush();
    s.stream.enqueue(new Uint8Array(48_000));
    s.stream.close();
    await work;
    expect(s.controller.snapshot.phase).toBe("loading");
    await vi.advanceTimersByTimeAsync(100);
    expect(s.controller.snapshot.phase).toBe("playing");
    await vi.advanceTimersByTimeAsync(1000);
    s.context.sources.at(-1)?.end();
    await flush();
    expect(s.controller.snapshot.phase).toBe("ended");
    expect(s.controller.snapshot.activeOutputs).toBe(0);
  });

  it("recovers NotAllowedError using the retained WAV and position without synthesis", async () => {
    const s = setup();
    s.audio.playResult = () =>
      s.audio.loop ? Promise.resolve() : Promise.reject(new DOMException("no", "NotAllowedError"));
    await s.controller.play({ ...request, rate: 1.5 });
    expect(s.controller.snapshot).toMatchObject({ phase: "blocked", reason: "not-allowed" });
    s.audio.metadata();
    await s.controller.seek("main", 1.25);
    s.audio.playResult = undefined;
    const work = s.controller.resume("main");
    expect(s.context.resume).toHaveBeenCalledTimes(2); // Before await.
    await work;
    expect(s.controller.snapshot).toMatchObject({ phase: "playing", position: 1.25 });
    expect(s.speech.request).toHaveBeenCalledTimes(1);
  });

  it.each(["reject", "pending", "suspended", "interrupted"])(
    "blocks %s context resume and keeps PCM for recovery",
    async (mode) => {
      const s = setup();
      const pending = deferred<void>();
      s.context.change("suspended");
      s.context.resumeResult = () => {
        if (mode === "reject") return Promise.reject(new DOMException("no", "NotAllowedError"));
        if (mode === "pending") return pending.promise;
        if (mode === "interrupted") s.context.state = "interrupted";
        return Promise.resolve();
      };
      const work = s.controller.play(request);
      await flush();
      if (mode === "pending") await vi.advanceTimersByTimeAsync(101);
      await flush();
      s.stream.enqueue(new Uint8Array(48_000));
      s.stream.close();
      await work;
      expect(s.controller.snapshot).toMatchObject({
        phase: "blocked",
        reason: {
          reject: "not-allowed",
          pending: "resume-timeout",
          suspended: "suspended",
          interrupted: "interrupted",
        }[mode],
      });
      expect(s.context.sources).toHaveLength(0);
      pending.resolve();
      s.context.change("running");
      await flush();
      expect(s.controller.snapshot.phase).toBe("blocked");
      s.context.resumeResult = undefined;
      await s.controller.resume("main");
      await vi.advanceTimersByTimeAsync(81);
      expect(s.controller.snapshot.phase).toBe("playing");
      expect(s.speech.stream).toHaveBeenCalledTimes(1);
      expect(s.speech.request).not.toHaveBeenCalled();
    },
  );

  it("keeps user pause separate from system suspension and visibility", async () => {
    const s = setup();
    const work = s.controller.play(request);
    await flush();
    s.stream.enqueue(new Uint8Array(96_000));
    await flush();
    await vi.advanceTimersByTimeAsync(400);
    const position = s.controller.snapshot.position;
    s.controller.pause("main");
    expect(s.controller.snapshot).toMatchObject({
      phase: "paused",
      reason: "user",
      activeOutputs: 0,
    });
    expect(s.controller.snapshot.position).toBeCloseTo(position);
    s.stream.close();
    await work;
    await s.controller.resume("main");
    await vi.advanceTimersByTimeAsync(100);
    s.context.change("suspended");
    expect(s.controller.snapshot).toMatchObject({
      phase: "interrupted",
      reason: "suspended",
      activeOutputs: 0,
    });
    await s.controller.resume("main");
    await vi.advanceTimersByTimeAsync(100);
    Object.defineProperty(s.doc, "visibilityState", { value: "hidden" });
    s.doc.dispatchEvent(new Event("visibilitychange"));
    expect(s.controller.snapshot).toMatchObject({ phase: "interrupted", reason: "visibility" });
    Object.defineProperty(s.doc, "visibilityState", { value: "visible" });
    s.doc.dispatchEvent(new Event("visibilitychange"));
    expect(s.controller.snapshot.phase).toBe("interrupted");
  });

  it("does not restart late resume after pause or an owner change", async () => {
    const s = setup();
    const work = s.controller.play(request);
    await flush();
    s.stream.enqueue(new Uint8Array(96_000));
    s.stream.close();
    await work;
    await vi.advanceTimersByTimeAsync(100);
    s.controller.pause("main");
    const pending = deferred<void>();
    s.context.resumeResult = () => pending.promise;
    const resuming = s.controller.resume("main");
    await vi.advanceTimersByTimeAsync(101);
    await resuming;
    expect(s.controller.snapshot.reason).toBe("resume-timeout");
    s.controller.pause("main");
    pending.resolve();
    s.context.change("running");
    await flush();
    expect(s.controller.snapshot).toMatchObject({ phase: "paused", activeOutputs: 0 });
    s.context.resumeResult = undefined;
    const next = s.controller.play({ ...request, owner: "sample", rate: 1.5 });
    expect(s.controller.snapshot.owner).toBe("sample");
    await next;
    expect(s.controller.snapshot).toMatchObject({
      phase: "playing",
      owner: "sample",
      activeOutputs: 1,
    });
    s.controller.stop("main");
    expect(s.controller.snapshot.owner).toBe("sample");
  });

  it("stops old output synchronously and ignores old synthesis, callbacks and errors", async () => {
    const s = setup();
    const old = deferred<SpeechAudio>();
    const synth = vi.mocked(s.speech.request);
    synth.mockImplementationOnce(() => old.promise);
    const first = s.controller.play({ ...request, rate: 1.5 });
    await flush();
    const oldGeneration = s.controller.snapshot.generation;
    const second = s.controller.play({
      ...request,
      owner: "review",
      input: { text: "second" },
      rate: 1.5,
    });
    expect(s.audio.paused || s.audio.loop).toBe(true);
    expect(s.controller.snapshot.generation).toBeGreaterThan(oldGeneration);
    await second;
    const before = s.controller.snapshot;
    old.resolve(asset);
    await first;
    expect(s.controller.snapshot).toEqual(before);
    s.audio.dispatchEvent(new Event("ended"));
    expect(s.controller.snapshot.phase).toBe("playing");
    expect(s.states.every((state) => state.activeOutputs <= 1)).toBe(true);
  });

  it("cancels a stream reader and exposes an immediately actionable stop state", async () => {
    const s = setup();
    const work = s.controller.play(request);
    await flush();
    s.stream.enqueue(new Uint8Array(48_000));
    await flush();
    s.controller.stop("main");
    await work;
    expect(s.cancelled).toHaveBeenCalledTimes(1);
    expect(s.controller.snapshot.owner).toBeUndefined();
    expect(s.controller.snapshot).toMatchObject({
      phase: "idle",

      activeOutputs: 0,
    });
    expect(s.context.sources.every((source) => source.stopped)).toBe(true);
  });

  it("snapshots settings and invalidates preloads by voice and rate", async () => {
    const s = setup();
    await s.controller.preload(request);
    expect(s.controller.isPrepared(request)).toBe(true);
    await s.controller.play({ ...request, rate: undefined });
    s.settings({ voice: "B", rate: 1.5 });
    expect(s.controller.isPrepared({ ...request, rate: undefined })).toBe(false);
    expect(s.controller.snapshot).toMatchObject({
      input: { voice: "A" },
      rate: 1,
      phase: "playing",
    });
    s.controller.pause("main");
    await s.controller.resume("main");
    expect(s.speech.request).toHaveBeenCalledTimes(1);
    expect(s.audio.playbackRate).toBe(1);
    await s.controller.play({ ...request, rate: undefined });
    expect(s.controller.snapshot).toMatchObject({ input: { voice: "B" }, rate: 1.5 });
  });

  it("invalidates pending preloads even if an adapter ignores abort", async () => {
    const s = setup();
    const pending = deferred<SpeechAudio>();
    vi.mocked(s.speech.request).mockImplementationOnce(() => pending.promise);
    const work = s.controller.preload(request).catch((error) => error);
    s.settings({ voice: "A", rate: 1.5 });
    pending.resolve(asset);
    expect((await work).name).toBe("AbortError");
    expect(s.controller.isPrepared(request)).toBe(false);
  });

  it("joins a pending preload through the shared WAV adapter instead of starting PCM", async () => {
    const s = setup();
    const pending = deferred<SpeechAudio>();
    vi.mocked(s.speech.request).mockImplementation(() => pending.promise);
    const preload = s.controller.preload(request);
    const play = s.controller.play(request);
    await flush();
    pending.resolve(asset);
    await Promise.all([preload, play]);
    expect(s.speech.stream).not.toHaveBeenCalled();
    expect(s.controller.snapshot.phase).toBe("playing");
  });

  it("preserves paused WAV seek and releases content URLs at stop and prime at dispose", async () => {
    const s = setup();
    await s.controller.play({ ...request, rate: 1.5 });
    s.audio.metadata();
    s.controller.pause("main");
    await s.controller.seek("main", 2);
    expect(s.controller.snapshot).toMatchObject({ phase: "paused", position: 2, activeOutputs: 0 });
    expect(s.audio.plays).toHaveLength(2);
    s.controller.stop("main");
    expect(s.urls.revokeObjectURL).toHaveBeenCalledTimes(1);
    s.controller.dispose();
    expect(s.urls.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(s.context.close).toHaveBeenCalledTimes(1);
  });

  it("preserves blocked state when seeking a completed PCM asset", async () => {
    const s = setup();
    s.context.resumeResult = () => Promise.reject(new Error("no"));
    const work = s.controller.play(request);
    await flush();
    s.stream.enqueue(new Uint8Array(48_000));
    s.stream.close();
    await work;
    s.audio.metadata();
    await s.controller.seek("main", 0.5);
    expect(s.controller.snapshot).toMatchObject({
      phase: "blocked",
      transport: "wav",
      position: 0.5,
    });
    s.context.resumeResult = undefined;
    await s.controller.resume("main");
    expect(s.controller.snapshot.phase).toBe("playing");
  });

  it("reports synthesis failures as error, with no output", async () => {
    const s = setup();
    vi.mocked(s.speech.request).mockRejectedValueOnce(new Error("synthesis"));
    await s.controller.play({ ...request, rate: 1.5 });
    expect(s.controller.snapshot).toMatchObject({ phase: "error", activeOutputs: 0 });
    expect(s.audio.paused).toBe(true);
  });
});

it("can seek after EOF before the first PCM schedule starts", async () => {
  const s = setup();
  const work = s.controller.play(request);
  await flush();
  s.stream.enqueue(new Uint8Array(48_000));
  s.stream.close();
  await work;
  s.audio.metadata();
  expect(s.controller.snapshot.phase).toBe("loading");
  await s.controller.seek("main", 0.5);
  expect(s.controller.snapshot).toMatchObject({
    phase: "playing",
    transport: "wav",
    position: 0.5,
  });
  await vi.advanceTimersByTimeAsync(200);
  expect(s.controller.snapshot.transport).toBe("wav");
});

it("does not apply a late WAV play resolution after pause or stop", async () => {
  const s = setup();
  const pending = deferred<void>();
  s.audio.playResult = () => (s.audio.loop ? Promise.resolve() : pending.promise);
  const work = s.controller.play({ ...request, rate: 1.5 });
  await flush();
  s.controller.pause("main");
  pending.resolve();
  await work;
  expect(s.controller.snapshot).toMatchObject({ phase: "paused", activeOutputs: 0 });
  s.controller.stop("main");
  expect(s.controller.snapshot.phase).toBe("idle");
});

it("ignores late resume when a different owner has started WAV", async () => {
  const s = setup();
  const work = s.controller.play(request);
  await flush();
  s.stream.enqueue(new Uint8Array(48_000));
  s.stream.close();
  await work;
  await vi.advanceTimersByTimeAsync(100);
  s.controller.pause("main");
  const pending = deferred<void>();
  s.context.resumeResult = () => pending.promise;
  const resuming = s.controller.resume("main");
  s.context.resumeResult = undefined;
  await s.controller.play({ ...request, owner: "review", rate: 1.5 });
  pending.resolve();
  await resuming;
  expect(s.controller.snapshot).toMatchObject({
    owner: "review",
    phase: "playing",
    activeOutputs: 1,
  });
  expect(s.context.sources.every((source) => source.stopped)).toBe(true);
});

it("supersedes a stale preload for the same segment while preserving other callers", async () => {
  const s = setup();
  const old = deferred<SpeechAudio>();
  vi.mocked(s.speech.request).mockImplementationOnce(() => old.promise);
  const preload = s.controller.preload(request).catch((error) => error);
  const fresh = { ...request, input: { text: "edited" } };
  await s.controller.preload(fresh);
  old.resolve(asset);
  expect((await preload).name).toBe("AbortError");
  expect(s.controller.isPrepared(fresh)).toBe(true);
  expect(s.controller.isPrepared(request)).toBe(false);
});

it("does not fill a cleared cache with a late PCM completion", async () => {
  const s = setup();
  const work = s.controller.play(request);
  await flush();
  s.stream.enqueue(new Uint8Array(48_000));
  await flush();
  s.cache.clear();
  s.stream.close();
  await work;
  expect(s.cache.get({ text: "first", voice: "A" })).toBeUndefined();
});

it("records a system suspension while synthesis is still pending", async () => {
  const s = setup();
  const delayed =
    deferred<ReturnType<SpeechAdapter["stream"]> extends Promise<infer T> ? T : never>();
  vi.mocked(s.speech.stream).mockReturnValueOnce(delayed.promise);
  const work = s.controller.play(request);
  await flush();
  s.context.change("suspended");
  expect(s.controller.snapshot).toMatchObject({ phase: "interrupted", reason: "suspended" });
  delayed.resolve({
    reader: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(48_000));
        c.close();
      },
    }).getReader(),
    sampleRate: 24_000,
  });
  await work;
  expect(s.controller.snapshot).toMatchObject({ phase: "interrupted", activeOutputs: 0 });
  await s.controller.resume("main");
  await vi.advanceTimersByTimeAsync(100);
  expect(s.controller.snapshot.phase).toBe("playing");
});

it("stops active PCM synchronously when another owner claims output", async () => {
  const s = setup();
  const work = s.controller.play(request);
  await flush();
  s.stream.enqueue(new Uint8Array(96_000));
  await flush();
  await vi.advanceTimersByTimeAsync(100);
  expect(s.controller.snapshot.phase).toBe("playing");
  const next = s.controller.play({ ...request, owner: "review", rate: 1.5 });
  expect(s.context.sources.every((source) => source.stopped)).toBe(true);
  expect(s.controller.snapshot.owner).toBe("review");
  await Promise.all([work, next]);
  expect(s.states.every((state) => state.activeOutputs <= 1)).toBe(true);
});

it("resolves resume at a fully consumed PCM tail without getting stuck loading", async () => {
  const s = setup();
  const work = s.controller.play(request);
  await flush();
  s.stream.enqueue(new Uint8Array(48_000));
  await flush();
  await vi.advanceTimersByTimeAsync(1200);
  s.context.sources.at(-1)?.end();
  s.controller.pause("main");
  s.stream.close();
  await work;
  await s.controller.resume("main");
  expect(s.controller.snapshot).toMatchObject({ phase: "ended", activeOutputs: 0 });
});

it("keeps voice samples out of the narration cache while reusing the single output", async () => {
  const samples = new SpeechCache(8);
  const sampleSpeech: SpeechAdapter = {
    get: (input) => samples.get(input),
    set: (input, audio) => samples.set(input, audio),
    request: vi.fn(async (input) => {
      samples.set(input, asset);
      return asset;
    }),
    stream: vi.fn(),
  };
  const s = setup({ sampleSpeech });
  for (const text of ["first", "second", "third"]) s.cache.set({ text, voice: "A" }, asset);
  await s.controller.play({ ...request, rate: 1.5 });
  const sample = {
    owner: "sample" as const,
    segmentKey: "sample:B",
    input: { text: "Sample", voice: "B" },
    rate: 1,
  };
  await s.controller.play(sample);
  expect(s.controller.snapshot).toMatchObject({
    owner: "sample",
    phase: "playing",
    activeOutputs: 1,
  });
  expect(sampleSpeech.request).toHaveBeenCalledTimes(1);
  expect(sampleSpeech.request).toHaveBeenCalledWith(
    sample.input,
    expect.any(AbortSignal),
    "preview",
  );
  for (const text of ["first", "second", "third"])
    expect(s.cache.get({ text, voice: "A" })).toBe(asset);
  await s.controller.play({ ...request, rate: 1.5 });
  expect(s.speech.request).not.toHaveBeenCalled();
  await s.controller.play(sample);
  expect(sampleSpeech.request).toHaveBeenCalledTimes(1);
});

it("reports a native resource failure as a recoverable controller error", async () => {
  const s = setup({
    createContext: () => {
      throw new Error("Context unavailable");
    },
  });
  await s.controller.play(request);
  expect(s.controller.snapshot.phase).toBe("error");
  expect(s.controller.snapshot.error).toEqual(new Error("Context unavailable"));
  expect(s.controller.snapshot.activeOutputs).toBe(0);
});
