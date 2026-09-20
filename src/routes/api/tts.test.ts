import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";
import { issueSession, sessionCookie } from "~/lib/server/auth";
import { POST } from "./tts";

const originalEnv = { ...process.env };
const origin = "https://bragi.example";

afterEach(() => {
  process.env = { ...originalEnv };
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
  it("returns a playable deterministic WAV fixture", async () => {
    const response = await POST({ request: await request({ text: "冒險開始" }) } as APIEvent);
    const wav = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
  });

  it("rejects text over the product limit", async () => {
    const response = await POST({ request: await request({ text: "a".repeat(401) }) } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(413);
    expect(body.error.code).toBe("TEXT_TOO_LONG");
  });
});
