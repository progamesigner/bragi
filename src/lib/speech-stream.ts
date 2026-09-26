import { apiErrorMessage } from "./api";
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
  if (!response.ok)
    throw new Error(await apiErrorMessage(response, "Speech stream could not start"));

  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase();
  const sampleRate = Number(response.headers.get("x-audio-sample-rate"));
  if (mediaType !== "audio/l16" || sampleRate !== 24_000 || !response.body)
    throw new Error("Speech service returned an invalid stream");
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

export class PcmStreamPlayer {
  readonly #decoder = new Pcm16Decoder();
  readonly #sources = new Set<AudioBufferSourceNode>();
  #nextStart = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(
    readonly context: AudioContext,
    readonly sampleRate = 24_000,
    readonly rate = 1,
  ) {}

  append(chunk: Uint8Array): void {
    const samples = this.#decoder.decode(chunk);
    if (samples.length === 0) return;
    const buffer = this.context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.context.destination);
    const start = Math.max(this.#nextStart, this.context.currentTime + 0.08);
    this.#nextStart = start + buffer.duration / this.rate;
    this.#sources.add(source);
    this.#tail = new Promise((resolve) => {
      source.addEventListener(
        "ended",
        () => {
          this.#sources.delete(source);
          resolve();
        },
        { once: true },
      );
    });
    source.start(start);
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
    for (const source of this.#sources) source.stop();
    this.#sources.clear();
  }
}
