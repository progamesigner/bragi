import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { issueSession, sessionCookie } from "~/lib/server/auth";
import { POST } from "./tts";

const originalEnv = { ...process.env };
const origin = "https://bragi.example";

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

async function request(body: unknown) {
  process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  const token = await issueSession();
  return new Request(`${origin}/api/tts`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie(token).split(";")[0] ?? "",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/tts", () => {
  it("rejects a voice outside the server allowlist before contacting Gemini", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await POST({
      request: await request({ text: "hello", voice: "unapproved" }),
    } as APIEvent);
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns playable WAV audio from Gemini PCM", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "audio",
                  data: Buffer.from(new Uint8Array(48_000)).toString("base64"),
                  mime_type: "audio/l16",
                  sample_rate: 24_000,
                  channels: 1,
                },
              ],
            },
          ],
        }),
      ),
    );
    const response = await POST({ request: await request({ text: "冒險開始" }) } as APIEvent);
    const wav = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get("x-audio-duration-ms")).toBe("1000");
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  });

  it("rejects text over the product limit", async () => {
    const response = await POST({ request: await request({ text: "a".repeat(401) }) } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(413);
    expect(body.error.code).toBe("TEXT_TOO_LONG");
  });

  it("maps Gemini rate limits to the shared error contract", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "8" } })),
    );
    const response = await POST({ request: await request({ text: "冒險開始" }) } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("8");
    expect(body.error).toMatchObject({ code: "TTS_RATE_LIMITED", retryable: true });
  });
});
