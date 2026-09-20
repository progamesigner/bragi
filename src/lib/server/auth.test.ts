import { afterEach, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { hasValidSession, issueSession, sessionCookie, verifyTotp } from "./auth";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("session authentication", () => {
  it("verifies a current TOTP within the configured window", () => {
    process.env.BRAGI_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(process.env.BRAGI_TOTP_SECRET),
      digits: 6,
      period: 30,
    });
    expect(verifyTotp(totp.generate())).toBe(true);
    expect(verifyTotp("0000000")).toBe(false);
  });

  it("issues and validates a secure cookie JWT", async () => {
    process.env.BRAGI_SESSION_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.BRAGI_SESSION_VERSION = "1";
    const token = await issueSession();
    const request = new Request("https://bragi.example", {
      headers: { cookie: `${sessionCookie(token).split(";")[0]}` },
    });
    expect(await hasValidSession(request)).toBe(true);
    process.env.BRAGI_SESSION_VERSION = "2";
    expect(await hasValidSession(request)).toBe(false);
  });
});
