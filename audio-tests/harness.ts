import {
  AudioController,
  type AudioSnapshot,
  type SpeechAdapter,
} from "../src/lib/audio/controller";
import { SpeechCache } from "../src/lib/speech-cache";
import { pcmToWav } from "../src/lib/wav";

const params = new URLSearchParams(location.search);
const delayMs = Number(params.get("delay") ?? 6500);
const pcm = new Uint8Array(24_000 * 12 * 2);
const view = new DataView(pcm.buffer);
for (let i = 0; i < pcm.length / 2; i++)
  view.setInt16(i * 2, Math.sin((i * 2 * Math.PI * 440) / 24_000) * 1500, true);
const asset = { blob: new Blob([pcmToWav(pcm)], { type: "audio/wav" }), durationMs: 12_000 };
const cache = new SpeechCache();
cache.set({ text: "cached" }, asset);
const events: Record<string, unknown>[] = [];
let calls = 0;
let rejectContent = false;
let holdResume = false;
let failStream = false;
let context: AudioContext | undefined;
let element: HTMLAudioElement | undefined;
let preloadReady = false;
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
  });
const speech: SpeechAdapter = {
  get: (input) => cache.get(input),
  set: (input, audio) => cache.set(input, audio),
  async request(input, signal) {
    const cached = cache.get(input);
    if (cached) return cached;
    calls++;
    await sleep(input.text === "prefetched" ? 100 : delayMs, signal);
    events.push({ event: "synthesis-ready", active: navigator.userActivation?.isActive });
    cache.set(input, asset);
    return asset;
  },
  async stream(_input, signal) {
    calls++;
    await sleep(delayMs, signal);
    if (failStream) {
      failStream = false;
      throw new Error("Injected stream failure");
    }
    events.push({ event: "synthesis-ready", active: navigator.userActivation?.isActive });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (let offset = 0; offset < pcm.length; offset += 24_000) {
            signal.throwIfAborted();
            controller.enqueue(pcm.slice(offset, offset + 24_000));
            await sleep(40, signal);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return { reader: stream.getReader(), sampleRate: 24_000 };
  },
};
const audio = new AudioController({
  speech,
  settings: () => ({ rate: 1 }),
  subscribeSettings: () => () => {},
  timeoutMs: 1000,
  createAudio() {
    element = new Audio();
    const native = element.play.bind(element);
    element.play = () => {
      if (rejectContent && !element?.loop) {
        rejectContent = false;
        return Promise.reject(new DOMException("Injected content rejection", "NotAllowedError"));
      }
      return native();
    };
    return element;
  },
  createContext() {
    context = new AudioContext({ sampleRate: 24_000 });
    const native = context.resume.bind(context);
    context.resume = () => (holdResume ? sleep(2200).then(native) : native());
    return context;
  },
});
const seek = document.querySelector<HTMLInputElement>("#seek");
let lastPhase: string | undefined;
function snapshot() {
  return {
    ...audio.snapshot,
    calls,
    preloadReady,
    contextState: context?.state,
    contextTime: context?.currentTime,
    nativeTime: element?.currentTime,
    nativePaused: element?.paused,
    nativeRate: element?.playbackRate,
    preservesPitch: element?.preservesPitch,
  };
}
function render(state: AudioSnapshot) {
  if (state.phase !== lastPhase) {
    events.push({ event: "phase", phase: state.phase, owner: state.owner });
    lastPhase = state.phase;
  }
  const display = document.querySelector("#snapshot");
  if (display) display.textContent = JSON.stringify(snapshot());
  const log = document.querySelector("#events");
  if (log) log.textContent = JSON.stringify(events);
  if (seek) seek.disabled = !state.seekable;
}
audio.subscribe(render);
const start = (path: string, owner: "main" | "sample" = "main") => {
  events.push({ event: "gesture", path, active: navigator.userActivation?.isActive });
  return audio.play({
    owner,
    segmentKey: path,
    input: { text: path },
    rate: path === "rate" ? 1.5 : 1,
  });
};
for (const path of ["cached", "prefetched", "pcm", "rate"])
  document.querySelector(`#${path}`)?.addEventListener("click", () => void start(path));
document.querySelector("#prefetch")?.addEventListener("click", () => {
  void audio.preload({ segmentKey: "prefetched", input: { text: "prefetched" } }).then(() => {
    preloadReady = true;
    render(audio.snapshot);
  });
});
document.querySelector("#sample")?.addEventListener("click", () => void start("cached", "sample"));
document.querySelector("#pause")?.addEventListener("click", () => audio.pause("main"));
document.querySelector("#resume")?.addEventListener("click", () => {
  holdResume = false;
  void audio.resume("main");
});
document
  .querySelector("#stop")
  ?.addEventListener("click", () => audio.stop(audio.snapshot.owner ?? "main"));
document.querySelector("#interrupt")?.addEventListener("click", () => void context?.suspend());
document.querySelector("#reject")?.addEventListener("click", () => {
  rejectContent = true;
});
document.querySelector("#fail")?.addEventListener("click", () => {
  failStream = true;
});
document.querySelector("#hold")?.addEventListener("click", () => {
  holdResume = true;
});
seek?.addEventListener("input", () => void audio.seek("main", Number(seek.value)));
const autostart = params.get("autostart");
if (autostart) {
  void start(autostart);
  // Frozen before Playwright evaluates any page scripts or assertions.
  setTimeout(() => {
    const display = document.querySelector("#policy");
    if (display) display.textContent = JSON.stringify(snapshot());
  }, 1600);
}
window.addEventListener("pagehide", () => audio.dispose(), { once: true });
