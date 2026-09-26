import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiUpload, MAX_UPLOAD_BYTES, verifyUploadId } from "./uploads";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("Gemini upload sessions", () => {
  it("returns a same-origin proxy target with verifiable upload metadata", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: {
            "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session-id",
          },
        }),
      ),
    );

    const session = await createGeminiUpload("image/jpeg", 1234);

    expect(session.target.url).toBe("/api/upload-content");
    expect(session.target.headers["x-bragi-upload-id"]).toBe(session.uploadId);
    await expect(verifyUploadId(session.uploadId)).resolves.toEqual({
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      url: "https://generativelanguage.googleapis.com/upload/session-id",
    });
  });

  it("keeps proxied uploads below the Vercel payload limit", () => {
    expect(MAX_UPLOAD_BYTES).toBe(4_000_000);
  });

  it("lets the client cancel upload session creation", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.GEMINI_API_KEY = "test-key";
    const client = new AbortController();
    client.abort();
    const fetcher = vi.fn((_url: string, init: RequestInit) =>
      init.signal?.aborted ? Promise.reject(init.signal.reason) : Promise.resolve(new Response()),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(createGeminiUpload("image/jpeg", 1234, client.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
