import { afterEach, describe, expect, it, vi } from "vitest";
import { speechInput, synthesizeSpeech } from "./speech";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

function audioResponse(pcm: Uint8Array) {
  return Response.json({
    steps: [
      {
        type: "model_output",
        content: [
          {
            type: "audio",
            data: Buffer.from(pcm).toString("base64"),
            mime_type: "audio/L16;codec=pcm;rate=24000",
            channels: 1,
          },
        ],
      },
    ],
  });
}

describe("Gemini speech", () => {
  it("sends the transcript verbatim with directions as speech metadata", () => {
    expect(speechInput({ text: "只朗讀這一句", toneHint: "低沉", genreHint: "奇幻" })).toEqual([
      {
        type: "user_input",
        content: [
          {
            type: "text",
            text: "只朗讀這一句",
            annotations: [{ type: "speech_metadata", style: "低沉; Genre: 奇幻" }],
          },
        ],
      },
    ]);
    expect(speechInput({ text: "冒險開始" })[0]?.content[0]?.annotations).toEqual([
      { type: "speech_metadata", style: "Natural tabletop narration" },
    ]);
  });

  it("defaults to the current Gemini TTS model", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.GEMINI_TTS_MODEL;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(audioResponse(new Uint8Array(4_800))));
    await synthesizeSpeech({ text: "冒險開始" });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("gemini-3.8-flash-tts");
  });

  it("requests configured inline PCM and returns its duration", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_TTS_MODEL = "gemini-tts-test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(audioResponse(new Uint8Array(48_000))));

    await expect(synthesizeSpeech({ text: "冒險開始" })).resolves.toMatchObject({
      durationMs: 1000,
    });
    const init = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gemini-tts-test",
      store: false,
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24_000 },
      generation_config: { speech_config: [{ voice: "Kore" }] },
    });
  });

  it("retries one response that omits audio", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ steps: [{ type: "model_output", content: [] }] }))
        .mockResolvedValueOnce(audioResponse(new Uint8Array(4_800))),
    );

    await expect(synthesizeSpeech({ text: "重試" })).resolves.toMatchObject({ durationMs: 100 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("passes rate limits through without retrying", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "12" } })),
    );

    await expect(synthesizeSpeech({ text: "稍後再試" })).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfter: "12",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
