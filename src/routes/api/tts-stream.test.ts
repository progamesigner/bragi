import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueSession, sessionCookie } from "~/lib/server/auth";
import { POST } from "./tts-stream";

const originalEnv = { ...process.env };
const origin = "https://bragi.example";

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

async function request(body: unknown) {
  process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  const token = await issueSession();
  return new Request(`${origin}/api/tts-stream`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie(token).split(";")[0] ?? "",
      origin,
    },
    body: JSON.stringify(body),
  });
}

function upstreamStream(bytes: number[]): Response {
  const event = {
    event_type: "step.delta",
    delta: { type: "audio", data: Buffer.from(bytes).toString("base64") },
  };
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

describe("POST /api/tts-stream", () => {
  it("rejects unauthenticated streaming requests", async () => {
    const response = await POST({
      request: new Request(`${origin}/api/tts-stream`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ text: "第一段" }),
      }),
    } as APIEvent);

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("streams raw PCM from Gemini", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_TTS_VOICE = "Kore";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstreamStream([0, 1, 2, 3])));

    const response = await POST({ request: await request({ text: "第一段" }) } as APIEvent);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/L16;rate=24000;channels=1");
    expect(response.headers.get("x-audio-sample-rate")).toBe("24000");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3]);
  });

  it("maps a rate limit before opening the response body", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.GEMINI_TTS_VOICE = "Kore";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "8" } })),
    );

    const response = await POST({ request: await request({ text: "第一段" }) } as APIEvent);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("8");
    expect((await response.json()).error.code).toBe("TTS_RATE_LIMITED");
  });
});
