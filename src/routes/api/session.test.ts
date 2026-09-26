import type { APIEvent } from "@solidjs/start/server";
import { afterEach, describe, expect, it } from "vitest";
import { issueSession, sessionCookie } from "~/lib/server/auth";
import { DELETE, GET, POST } from "./session";

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

describe("GET /api/session", () => {
  it("reports a valid persistent session without exposing its token", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    const token = await issueSession();
    const response = await GET({
      request: new Request(`${origin}/api/session`, {
        headers: { cookie: sessionCookie(token).split(";")[0] ?? "" },
      }),
    } as APIEvent);

    expect(await response.json()).toMatchObject({ authenticated: true, voices: expect.any(Array) });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reports a missing session as signed out", async () => {
    const response = await GET({ request: new Request(`${origin}/api/session`) } as APIEvent);
    expect(await response.json()).toMatchObject({ authenticated: false });
  });
});

describe("DELETE /api/session", () => {
  it("expires the session cookie", async () => {
    const response = DELETE({
      request: new Request(`${origin}/api/session`, { method: "DELETE", headers: { origin } }),
    } as APIEvent);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toMatchObject({ authenticated: false });
  });
});
