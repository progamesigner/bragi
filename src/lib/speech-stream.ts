import { readApiError } from "./api";
import { t } from "./i18n";
import { requireOnline } from "./network";
import type { SpeechRequest } from "./speech";

export type SpeechPcmStream = {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  requestId?: string;
  sampleRate: number;
};

export async function openSpeechStream(
  input: SpeechRequest,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SpeechPcmStream> {
  requireOnline();
  const response = await fetcher("/api/tts-stream", {
    method: "POST",
    headers: { "content-type": "application/json", "x-bragi-speech-purpose": "playback" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) throw await readApiError(response, t("apiError.streamFailed"));

  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  const sampleRate = Number(response.headers.get("x-audio-sample-rate"));
  if (mediaType !== "audio/l16" || sampleRate !== 24_000 || !response.body)
    throw new Error(t("apiError.invalidStream"));
  return {
    reader: response.body.getReader(),
    requestId: response.headers.get("x-request-id") ?? undefined,
    sampleRate,
  };
}

export class Pcm16Decoder {
  #trailingByte: number | undefined;

  decode(chunk: Uint8Array): Float32Array<ArrayBuffer> {
    let bytes = chunk;
    if (this.#trailingByte !== undefined) {
      const joined = new Uint8Array(chunk.byteLength + 1);
      joined[0] = this.#trailingByte;
      joined.set(chunk, 1);
      bytes = joined;
      this.#trailingByte = undefined;
    }
    if (bytes.byteLength % 2 !== 0) {
      this.#trailingByte = bytes.at(-1);
      bytes = bytes.subarray(0, -1);
    }

    const samples = new Float32Array(new ArrayBuffer(bytes.byteLength * 2));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < samples.length; index += 1)
      samples[index] = view.getInt16(index * 2, true) / 32_768;
    return samples;
  }

  finish(): void {
    if (this.#trailingByte !== undefined) throw new Error("Speech stream ended mid-sample");
  }
}

export type PcmSchedule = {
  startTime: number;
  sampleOffset: number;
  duration: number;
};

export type PcmPlayerEvents = {
  scheduled?: (schedule: PcmSchedule) => void;
  started?: (schedule: PcmSchedule) => void;
};

export class PcmStreamPlayer {
  readonly #decoder = new Pcm16Decoder();
  readonly #sources = new Set<AudioBufferSourceNode>();
  readonly #timeline: PcmSchedule[] = [];
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();
  readonly #settle = new Set<() => void>();
  #nextStart = 0;
  #samples = 0;
  #stopped = false;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    readonly context: AudioContext,
    readonly sampleRate = 24_000,
    readonly events: PcmPlayerEvents = {},
  ) {}

  /** Media position excludes scheduling gaps, including stream underflow. */
  get position(): number {
    let position = 0;
    for (const entry of this.#timeline) {
      if (this.context.currentTime < entry.startTime) break;
      position =
        entry.sampleOffset / this.sampleRate +
        Math.min(entry.duration, this.context.currentTime - entry.startTime);
    }
    return position;
  }

  get bufferDuration(): number {
    return this.#samples / this.sampleRate;
  }

  get underflow(): boolean {
    return (
      !this.#stopped &&
      this.#timeline.length > 0 &&
      this.context.state === "running" &&
      this.context.currentTime >= this.#nextStart
    );
  }

  append(chunk: Uint8Array): PcmSchedule | undefined {
    if (this.#stopped) return;
    const samples = this.#decoder.decode(chunk);
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.#nextStart, this.context.currentTime + 0.08);
    const schedule = { startTime: start, sampleOffset: this.#samples, duration: buffer.duration };
    this.#samples += samples.length;
    this.#nextStart = start + buffer.duration;
    this.#timeline.push(schedule);
    this.#sources.add(source);
    this.#tail = new Promise((resolve) => {
      const settle = () => {
        source.disconnect?.();
        this.#sources.delete(source);
        this.#settle.delete(settle);
        resolve();
      };
      this.#settle.add(settle);
      source.addEventListener("ended", settle, { once: true });
    });
    source.start(start);
    this.events.scheduled?.(schedule);
    if (this.events.started) this.#watchStart(schedule);
    return schedule;
  }

  #watchStart(schedule: PcmSchedule): void {
    const check = () => {
      if (this.#stopped) return;
      if (this.context.state === "running" && this.context.currentTime >= schedule.startTime) {
        this.events.started?.(schedule);
        return;
      }
      const timer = setTimeout(
        () => {
          this.#timers.delete(timer);
          check();
        },
        Math.max(10, (schedule.startTime - this.context.currentTime) * 1000),
      );
      this.#timers.add(timer);
    };
    check();
  }

  async finish(): Promise<void> {
    this.#decoder.finish();
    await this.#tail;
  }

  async pause(): Promise<void> {
    if (this.context.state === "running") await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context.state !== "running") await this.context.resume();
  }

  stop(): void {
    this.#stopped = true;
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    for (const source of this.#sources) {
      source.stop();
      source.disconnect?.();
    }
    this.#sources.clear();
    for (const settle of this.#settle) settle();
  }
}
