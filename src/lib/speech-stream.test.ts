import { describe, expect, it, vi } from "vitest";
import { openSpeechStream, Pcm16Decoder, PcmStreamPlayer } from "./speech-stream";

it("schedules PCM chunks using the selected playback speed", () => {
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
  const player = new PcmStreamPlayer(context, 24_000, 1.5);
  player.append(new Uint8Array(48_000));
  player.append(new Uint8Array(48_000));
  expect(Number(starts[1]) - Number(starts[0])).toBeCloseTo(1 / 1.5);
  expect(rates).toEqual([1.5, 1.5]);
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
      "invalid stream",
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
