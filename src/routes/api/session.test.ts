import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./session";

const originalEnv = { ...process.env };
const origin = "https://bragi.example";

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("POST /api/session", () => {
  it("returns a sanitized service error when authentication is not configured", async () => {
    delete process.env.BRAGI_TOTP_SECRET;
    const response = await POST({
      request: new Request(`${origin}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ otp: "123456" }),
      }),
    } as APIEvent);
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.error.code).toBe("SERVICE_UNAVAILABLE");
    expect(body.error.requestId).toBe(response.headers.get("x-request-id"));
  });

  it("rejects malformed OTP input before reading configuration", async () => {
    const response = await POST({
      request: new Request(`${origin}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ otp: "123" }),
      }),
    } as APIEvent);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });
});
