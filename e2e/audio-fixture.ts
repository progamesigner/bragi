import type { Page } from "@playwright/test";

/** Deterministic native transports; production controller and API adapters remain in use. */
export async function mockAudio(page: Page) {
  await page.addInitScript(() => {
    type MediaState = { paused: boolean; ended: boolean; offset: number; since: number };
    const media = new WeakMap<HTMLMediaElement, MediaState>();
    const state = (audio: HTMLMediaElement) => {
      let value = media.get(audio);
      if (!value) {
        value = { paused: true, ended: false, offset: 0, since: performance.now() };
        media.set(audio, value);
      }
      return value;
    };
    const fixture = {
      audio: undefined as HTMLAudioElement | undefined,
      contexts: [] as MockContext[],
      duration: 8,
      freezePosition: false,
      rejectNext: false,
      holdStream: false,
      closeStream: undefined as (() => void) | undefined,
      plays: [] as { loop: boolean; rate: number; src: string }[],
      outputCount: () =>
        Number(!!fixture.audio && !fixture.audio.paused && !fixture.audio.loop) +
        fixture.contexts.reduce(
          (count, context) => count + context.sources.filter((source) => source.active).length,
          0,
        ),
      finish: () => {
        const context = fixture.contexts.at(-1);
        const source = context?.sources.findLast((entry) => entry.active);
        if (source) {
          context?.advance(fixture.duration);
          source.end();
        } else if (fixture.audio) {
          const value = state(fixture.audio);
          value.offset = fixture.duration;
          value.paused = true;
          value.ended = true;
          fixture.audio.dispatchEvent(new Event("ended"));
        }
      },
    };
    Object.assign(window, { audioTest: fixture });
    const Original = window.Audio;
    window.Audio = class extends Original {
      constructor(src?: string) {
        super(src);
        fixture.audio = this;
      }
    };
    Object.defineProperties(HTMLMediaElement.prototype, {
      paused: {
        configurable: true,
        get() {
          return state(this).paused;
        },
      },
      ended: {
        configurable: true,
        get() {
          return state(this).ended;
        },
      },
      duration: {
        configurable: true,
        get() {
          return fixture.duration;
        },
      },
      currentTime: {
        configurable: true,
        get() {
          const value = state(this);
          return (
            value.offset +
            (value.paused || fixture.freezePosition
              ? 0
              : ((performance.now() - value.since) / 1000) * this.playbackRate)
          );
        },
        set(seconds: number) {
          const value = state(this);
          value.offset = seconds;
          value.since = performance.now();
        },
      },
    });
    HTMLMediaElement.prototype.load = function () {
      const value = state(this);
      value.offset = 0;
      value.ended = false;
      value.paused = true;
      this.playbackRate = 1;
      queueMicrotask(() => {
        if (this.src) this.dispatchEvent(new Event("loadedmetadata"));
      });
    };
    HTMLMediaElement.prototype.play = function () {
      fixture.plays.push({ loop: this.loop, rate: this.playbackRate, src: this.src });
      if (!this.loop && fixture.rejectNext) {
        fixture.rejectNext = false;
        return Promise.reject(new DOMException("Blocked in test", "NotAllowedError"));
      }
      const value = state(this);
      value.paused = false;
      value.ended = false;
      value.since = performance.now();
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      const value = state(this);
      if (value.paused) return;
      value.offset = this.currentTime;
      value.paused = true;
      this.dispatchEvent(new Event("pause"));
    };
    class MockSource extends EventTarget {
      buffer?: { duration: number };
      active = false;
      connect() {}
      disconnect() {}
      start() {
        this.active = true;
      }
      stop() {
        this.end();
      }
      end() {
        this.active = false;
        this.dispatchEvent(new Event("ended"));
      }
    }
    class MockContext extends EventTarget {
      state = "running";
      destination = {};
      sources: MockSource[] = [];
      base = 0;
      since = performance.now();
      constructor() {
        super();
        fixture.contexts.push(this);
      }
      get currentTime() {
        return this.base + (this.state === "running" ? (performance.now() - this.since) / 1000 : 0);
      }
      advance(seconds: number) {
        this.base = this.currentTime + seconds;
        this.since = performance.now();
      }
      change(next: string) {
        this.base = this.currentTime;
        this.since = performance.now();
        this.state = next;
        this.dispatchEvent(new Event("statechange"));
      }
      resume() {
        this.change("running");
        return Promise.resolve();
      }
      suspend() {
        this.change("suspended");
        return Promise.resolve();
      }
      close() {
        this.change("closed");
        return Promise.resolve();
      }
      createBuffer(_channels: number, samples: number, rate: number) {
        return { duration: samples / rate, copyToChannel() {} };
      }
      createBufferSource() {
        const source = new MockSource();
        this.sources.push(source);
        return source;
      }
    }
    Object.assign(window, { AudioContext: MockContext });
    const fetcher = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetcher(...args);
      if (String(args[0]) !== "/api/tts-stream" || !fixture.holdStream || !response.ok)
        return response;
      const bytes = new Uint8Array(await response.arrayBuffer());
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          fixture.closeStream = () => {
            controller.close();
            fixture.closeStream = undefined;
          };
        },
        cancel() {
          fixture.closeStream = undefined;
        },
      });
      return new Response(stream, { headers: response.headers });
    };
  });
}

export type AudioTestFixture = {
  audio: HTMLAudioElement;
  contexts: {
    state: string;
    advance(seconds: number): void;
    suspend(): Promise<void>;
    resume(): Promise<void>;
  }[];
  duration: number;
  freezePosition: boolean;
  rejectNext: boolean;
  holdStream: boolean;
  closeStream?: () => void;
  outputCount(): number;
  finish(): void;
  plays: { loop: boolean; rate: number; src: string }[];
};
declare global {
  interface Window {
    audioTest: AudioTestFixture;
  }
}
