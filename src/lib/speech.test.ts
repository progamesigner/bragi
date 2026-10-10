import { describe, expect, it, vi } from "vitest";
import { requestSpeech, requestVoiceSample } from "./speech";
import { VOICE_SAMPLE_TEXTS } from "./voice-samples";

describe("speech client", () => {
  it("returns validated WAV audio metadata", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(["audio"], { type: "audio/wav" }), {
        headers: { "x-audio-duration-ms": "1250" },
      }),
    );

    const result = await requestSpeech({ text: "第一段", toneHint: "平靜" }, undefined, fetcher);

    expect(result.blob.type).toBe("audio/wav");
    expect(result.durationMs).toBe(1250);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/tts",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ text: "第一段", toneHint: "平靜" }),
      }),
    );
  });

  it("keeps the request ID and status of a failed request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: "Speech service is unavailable", requestId: "request-1" } },
          { status: 503 },
        ),
      );

    await expect(requestSpeech({ text: "第一段" }, undefined, fetcher)).rejects.toMatchObject({
      name: "ApiError",
      message: "無法產生語音。請稍後再試。",
      serverMessage: "Speech service is unavailable",
      details: { status: 503, requestId: "request-1", retryable: true },
    });
  });

  it("rejects a successful non-WAV response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Blob(["text"], { type: "text/plain" })));

    await expect(requestSpeech({ text: "第一段" }, undefined, fetcher)).rejects.toThrow(
      "音訊格式不正確",
    );
  });
});

describe("voice samples", () => {
  const wav = () =>
    new Response(new Blob(["audio"], { type: "audio/wav" }), {
      headers: { "x-audio-duration-ms": "900" },
    });

  it("plays the pre-generated file for a sample line without calling Gemini", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(new Blob(["m4a"]), { headers: { "content-type": "audio/mp4" } }),
      );

    const result = await requestVoiceSample(
      { text: VOICE_SAMPLE_TEXTS.ja, voice: "Puck" },
      undefined,
      fetcher,
    );

    expect(await result.blob.text()).toBe("m4a");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/voice-samples/ja/Puck.m4a", expect.anything());
  });

  it("falls back to live speech when the file is missing or is the app shell", async () => {
    for (const missing of [
      new Response("not found", { status: 404 }),
      new Response("<!doctype html>", { headers: { "content-type": "text/html" } }),
    ]) {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce(wav());

      const result = await requestVoiceSample(
        { text: VOICE_SAMPLE_TEXTS.de, voice: "Kore" },
        undefined,
        fetcher,
      );

      expect(result.durationMs).toBe(900);
      expect(fetcher).toHaveBeenLastCalledWith(
        "/api/tts",
        expect.objectContaining({ method: "POST" }),
      );
    }
  });

  it("synthesizes any other text live", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => wav());

    await requestVoiceSample({ text: "第一段", voice: "Kore" }, undefined, fetcher);
    await requestVoiceSample(
      { text: VOICE_SAMPLE_TEXTS.en, voice: "Kore", toneHint: "calm" },
      undefined,
      fetcher,
    );

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/tts", "/api/tts"]);
  });
});
