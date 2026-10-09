import { describe, expect, it, vi } from "vitest";
import { openSpeechStream, Pcm16Decoder, PcmStreamPlayer } from "./speech-stream";

it("schedules PCM chunks back to back at their natural rate", () => {
  const starts: number[] = [];
  const rates: number[] = [];
  const context = {
    currentTime: 0,
    destination: {},
    createBuffer: (_channels: number, samples: number, sampleRate: number) => ({
      duration: samples / sampleRate,
      copyToChannel() {},
    }),
    createBufferSource: () => {
      const source = {
        buffer: undefined,
        playbackRate: { value: 1 },
        connect() {},
        addEventListener() {},
        start(time: number) {
          starts.push(time);
          rates.push(source.playbackRate.value);
        },
      };
      return source;
    },
  } as unknown as AudioContext;
  const player = new PcmStreamPlayer(context, 24_000);
  player.append(new Uint8Array(48_000));
  player.append(new Uint8Array(48_000));
  expect(Number(starts[1]) - Number(starts[0])).toBeCloseTo(1);
  expect(rates).toEqual([1, 1]);
});

describe("speech stream client", () => {
  it("opens a validated PCM stream", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([0, 1]), {
        headers: {
          "content-type": "audio/L16;rate=24000;channels=1",
          "x-audio-sample-rate": "24000",
          "x-request-id": "request-1",
        },
      }),
    );

    const stream = await openSpeechStream({ text: "第一段" }, undefined, fetcher);

    expect(stream.sampleRate).toBe(24_000);
    expect(stream.requestId).toBe("request-1");
    expect((await stream.reader.read()).value).toEqual(new Uint8Array([0, 1]));
  });

  it("rejects an unexpected streaming format", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("text", { headers: { "content-type": "text/plain" } }));

    await expect(openSpeechStream({ text: "第一段" }, undefined, fetcher)).rejects.toThrow(
      "串流格式不正確",
    );
  });
});

describe("PCM stream decoding", () => {
  it("preserves samples split across transport chunks", () => {
    const decoder = new Pcm16Decoder();
    expect(decoder.decode(new Uint8Array([0]))).toHaveLength(0);
    expect([...decoder.decode(new Uint8Array([128, 255, 127]))]).toEqual([-1, 32_767 / 32_768]);
    expect(() => decoder.finish()).not.toThrow();
  });

  it("rejects a stream ending mid-sample", () => {
    const decoder = new Pcm16Decoder();
    decoder.decode(new Uint8Array([1]));
    expect(() => decoder.finish()).toThrow("mid-sample");
  });
});

it("reports sample scheduling and excludes underflow gaps from media position", () => {
  let clock = 0;
  const context = {
    state: "running",
    get currentTime() {
      return clock;
    },
    destination: {},
    createBuffer: (_channels: number, samples: number, rate: number) => ({
      duration: samples / rate,
      copyToChannel() {},
    }),
    createBufferSource: () => ({ connect() {}, addEventListener() {}, start() {}, stop() {} }),
  } as unknown as AudioContext;
  const scheduled = vi.fn();
  const player = new PcmStreamPlayer(context, 24_000, { scheduled });
  player.append(new Uint8Array(48_000));
  expect(scheduled).toHaveBeenCalledWith({ startTime: 0.08, sampleOffset: 0, duration: 1 });
  clock = 3;
  expect(player.position).toBe(1);
  expect(player.underflow).toBe(true);
  player.append(new Uint8Array(24_000));
  expect(scheduled).toHaveBeenLastCalledWith({
    startTime: 3.08,
    sampleOffset: 24_000,
    duration: 0.5,
  });
  clock = 3.33;
  expect(player.position).toBeCloseTo(1.25);
  expect(player.bufferDuration).toBe(1.5);
  player.stop();
});
