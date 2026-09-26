import { afterEach, describe, expect, it, vi } from "vitest";
import { recognizeImage, resolveGeminiFile } from "./gemini";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("Gemini files", () => {
  it("resolves an active upload against server-side metadata", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          name: "files/image-1",
          mimeType: "image/jpeg",
          sizeBytes: "1234",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
          state: "ACTIVE",
        }),
      ),
    );

    await expect(
      resolveGeminiFile(
        { file: { name: "files/image-1" } },
        {
          mimeType: "image/jpeg",
          sizeBytes: 1234,
        },
      ),
    ).resolves.toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
      mimeType: "image/jpeg",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/files/image-1",
      expect.objectContaining({ headers: { "x-goog-api-key": "test-key" } }),
    );
  });

  it("rejects receipt metadata that does not match the upload token", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          name: "files/image-1",
          mimeType: "image/png",
          sizeBytes: "1234",
          uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
          state: "ACTIVE",
        }),
      ),
    );

    await expect(
      resolveGeminiFile(
        { file: { name: "files/image-1" } },
        {
          mimeType: "image/jpeg",
          sizeBytes: 1234,
        },
      ),
    ).rejects.toMatchObject({ kind: "invalid-file" });
  });
});

describe("Gemini OCR", () => {
  it("returns schema-validated narration segments", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_OCR_MODEL = "gemini-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    detectedLanguage: "zh-Hant",
                    segments: [
                      { id: "duplicate", text: "古老的門緩緩開啟。", suggestedToneHint: "低沉" },
                      { id: "duplicate", text: "火光照亮大廳。", suggestedToneHint: "平靜" },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );

    await expect(
      recognizeImage(
        {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
          mimeType: "image/jpeg",
        },
        "奇幻",
      ),
    ).resolves.toMatchObject({
      detectedLanguage: "zh-Hant",
      segments: [{ id: "segment-1" }, { id: "segment-2" }],
    });

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: "gemini-test",
      store: false,
      input: [{ type: "text" }, { type: "image", mime_type: "image/jpeg", resolution: "high" }],
      response_format: { type: "text", mime_type: "application/json" },
    });
    expect(body.input[0].text).toContain("奇幻");
  });

  it("rejects malformed model output", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          steps: [{ type: "model_output", content: [{ type: "text", text: "{}" }] }],
        }),
      ),
    );

    await expect(
      recognizeImage({ uri: "https://example.invalid/image", mimeType: "image/jpeg" }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("forwards client cancellation to file lookup and OCR", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const client = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetcher);

    await expect(
      resolveGeminiFile(
        { file: { name: "files/image-1" } },
        { mimeType: "image/jpeg", sizeBytes: 1 },
        client.signal,
      ),
    ).rejects.toThrow();
    await expect(
      recognizeImage(
        {
          uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
          mimeType: "image/jpeg",
        },
        undefined,
        client.signal,
      ),
    ).rejects.toThrow();

    const signals = fetcher.mock.calls.map(([, init]) => (init as RequestInit).signal);
    expect(signals.every((signal) => signal?.aborted === false)).toBe(true);
    client.abort();
    expect(signals.every((signal) => signal?.aborted === true)).toBe(true);
  });
});
