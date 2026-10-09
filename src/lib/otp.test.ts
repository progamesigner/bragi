import { describe, expect, it } from "vitest";
import { canSendOtp, editOtp, sanitizeOtp } from "./otp";

describe("one-time code input", () => {
  it("keeps the first six digits of typed, pasted or autofilled text", () => {
    expect(sanitizeOtp("123 456")).toBe("123456");
    expect(sanitizeOtp("１２3-45678")).toBe("123456");
    expect(sanitizeOtp("12a")).toBe("12");
  });

  it("sends only complete codes and never while a request is in flight", () => {
    expect(canSendOtp({ code: "12345" }, false)).toBe(false);
    expect(canSendOtp({ code: "123456" }, false)).toBe(true);
    expect(canSendOtp({ code: "123456" }, true)).toBe(false);
  });

  it("blocks a rejected code until the input changes, even back to the same code", () => {
    const rejected = { code: "123456", rejected: "123456" };
    expect(canSendOtp(rejected, false)).toBe(false);
    // Re-entering identical text is not a change.
    expect(editOtp(rejected, "123456")).toBe(rejected);
    const shorter = editOtp(rejected, "12345");
    expect(canSendOtp(shorter, false)).toBe(false);
    const retyped = editOtp(shorter, "123456");
    expect(canSendOtp(retyped, false)).toBe(true);
    expect(canSendOtp(editOtp(rejected, "654321"), false)).toBe(true);
  });
});
