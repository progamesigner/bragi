import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueSession, sessionCookie } from "~/lib/server/auth";
import { createGeminiUpload } from "~/lib/server/uploads";
import { POST } from "./ocr";

const originalEnv = { ...process.env };
const origin = "https://bragi.example";

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

async function authenticatedRequest(body: unknown) {
  process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  const token = await issueSession();
  return new Request(`${origin}/api/ocr`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie(token).split(";")[0] ?? "",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/ocr", () => {
  it("rejects unauthenticated requests with the shared error contract", async () => {
    const response = await POST({
      request: new Request(`${origin}/api/ocr`, { method: "POST", headers: { origin } }),
    } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("returns Gemini segments for a verified upload", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: {
              "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session-id",
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            name: "files/image-1",
            mimeType: "image/jpeg",
            sizeBytes: "1234",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
            state: "ACTIVE",
          }),
        )
        .mockResolvedValueOnce(
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
                        {
                          id: "segment-1",
                          text: "古老的門緩緩開啟。",
                          suggestedToneHint: "低沉地敘述",
                        },
                      ],
                    }),
                  },
                ],
              },
            ],
          }),
        ),
    );
    const upload = await createGeminiUpload("image/jpeg", 1234);
    const response = await POST({
      request: await authenticatedRequest({
        uploadId: upload.uploadId,
        receipt: { file: { name: "files/image-1" } },
      }),
    } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.detectedLanguage).toBe("zh-Hant");
    expect(body.segments).toHaveLength(1);
  });

  it("reports a processing upload as retryable", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: {
              "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session-id",
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            name: "files/image-1",
            mimeType: "image/jpeg",
            sizeBytes: "1234",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
            state: "PROCESSING",
          }),
        ),
    );
    const upload = await createGeminiUpload("image/jpeg", 1234);

    const response = await POST({
      request: await authenticatedRequest({
        uploadId: upload.uploadId,
        receipt: { file: { name: "files/image-1" } },
      }),
    } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body.error).toMatchObject({ code: "UPLOAD_PROCESSING", retryable: true });
  });

  it("aborts Gemini OCR when the client disconnects", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.GEMINI_API_KEY = "test-key";
    const client = new AbortController();
    const upstream: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: {
              "x-goog-upload-url": "https://generativelanguage.googleapis.com/upload/session-id",
            },
          }),
        )
        .mockResolvedValueOnce(
          Response.json({
            name: "files/image-1",
            mimeType: "image/jpeg",
            sizeBytes: "1234",
            uri: "https://generativelanguage.googleapis.com/v1beta/files/image-1",
            state: "ACTIVE",
          }),
        )
        .mockImplementationOnce((_url: string, init: RequestInit) => {
          const signal = init.signal as AbortSignal;
          upstream.push(signal);
          client.abort();
          return new Promise((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason);
            signal.addEventListener("abort", () => reject(signal.reason));
          });
        }),
    );
    const upload = await createGeminiUpload("image/jpeg", 1234);
    const request = await authenticatedRequest({
      uploadId: upload.uploadId,
      receipt: { file: { name: "files/image-1" } },
    });

    const response = await POST({
      request: new Request(request, { signal: client.signal }),
    } as APIEvent);

    expect(upstream[0]?.aborted).toBe(true);
    expect(response.status).toBe(499);
    expect((await response.json()).error.code).toBe("REQUEST_CANCELLED");
  });
});
