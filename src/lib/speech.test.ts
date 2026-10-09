import { describe, expect, it, vi } from "vitest";
import { requestSpeech } from "./speech";

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
