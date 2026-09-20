import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";
import { issueSession, sessionCookie } from "~/lib/server/auth";
import { POST } from "./uploads";

const originalEnv = { ...process.env };
const origin = "https://bragi.example";

afterEach(() => {
  process.env = { ...originalEnv };
});

async function request(body: unknown) {
  process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  const token = await issueSession();
  return new Request(`${origin}/api/uploads`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie(token).split(";")[0] ?? "",
      origin,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/uploads", () => {
  it("rejects unsupported media with the shared error contract", async () => {
    const response = await POST({
      request: await request({ mimeType: "image/gif", sizeBytes: 100 }),
    } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(415);
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("rejects files over the proxy limit", async () => {
    const response = await POST({
      request: await request({ mimeType: "image/jpeg", sizeBytes: 4_000_001 }),
    } as APIEvent);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("FILE_TOO_LARGE");
  });

  it("reports malformed upload metadata as an invalid request", async () => {
    const response = await POST({
      request: await request({ mimeType: "image/jpeg", sizeBytes: "100" }),
    } as APIEvent);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });
});
