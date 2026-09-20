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

  it("returns deterministic segments for a valid upload", async () => {
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
    const upload = await createGeminiUpload("image/jpeg", 1234);
    const response = await POST({
      request: await authenticatedRequest({ uploadId: upload.uploadId, receipt: {} }),
    } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.detectedLanguage).toBe("zh-Hant");
    expect(body.segments).toHaveLength(2);
  });
});
