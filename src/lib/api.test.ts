import { describe, expect, it } from "vitest";
import { ApiError, onUnauthorized, parseRetryAfter, readApiError } from "./api";
import { describeError } from "./network";

describe("API errors", () => {
  it("keeps code, status, request ID and retryability and explains the cause", async () => {
    const response = Response.json(
      {
        error: {
          code: "INVALID_OTP",
          message: "OTP is invalid or expired",
          requestId: "request-1",
          retryable: false,
        },
      },
      { status: 401 },
    );

    const error = await readApiError(response, "驗證失敗");
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message).toBe("驗證碼錯誤或已過期。請輸入驗證器 App 目前顯示的 6 位數字。");
    expect(error.message).not.toContain("request-1");
    expect(error.serverMessage).toBe("OTP is invalid or expired");
    expect(error.details).toEqual({
      code: "INVALID_OTP",
      status: 401,
      requestId: "request-1",
      retryable: false,
      retryAfter: undefined,
    });
  });

  it("reads Retry-After and mentions the wait", async () => {
    const response = Response.json(
      { error: { code: "TTS_RATE_LIMITED", requestId: "r", retryable: true } },
      { status: 429, headers: { "retry-after": "12" } },
    );
    const error = await readApiError(response, "無法產生語音");
    expect(error.details).toMatchObject({ retryable: true, retryAfter: 12 });
    expect(error.message).toContain("12 秒");
  });

  it("falls back to the caller's cause, the status and the request ID header", async () => {
    const response = new Response("upstream error", {
      status: 502,
      headers: { "x-request-id": "header-id" },
    });
    const error = await readApiError(response, "服務暫時無法使用");
    expect(error.message).toBe("服務暫時無法使用。請稍後再試。");
    expect(error.details).toMatchObject({ status: 502, requestId: "header-id", retryable: true });
    expect(error.details.code).toBeUndefined();
  });

  it("accepts Retry-After as seconds or an HTTP date", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("8", now)).toBe(8);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it("passes details through to the status line", async () => {
    const error = await readApiError(
      Response.json({ error: { code: "OCR_UNAVAILABLE", requestId: "ocr-1" } }, { status: 503 }),
      "無法辨識圖片",
    );
    expect(describeError(error, "x")).toEqual({ message: error.message, details: error.details });
    expect(describeError(new TypeError("fetch failed"), "x").details).toBeUndefined();
  });

  it("reports expired sessions, but not wrong one-time codes, as needing sign-in", async () => {
    let calls = 0;
    onUnauthorized(() => {
      calls += 1;
    });
    const reply = (code: string) =>
      Response.json(
        { error: { code, message: "", requestId: "r", retryable: false } },
        { status: 401 },
      );
    await readApiError(reply("INVALID_OTP"), "驗證失敗");
    expect(calls).toBe(0);
    await readApiError(reply("UNAUTHORIZED"), "無法辨識");
    expect(calls).toBe(1);
    onUnauthorized(undefined);
  });

  it("ignores a 401 when cancellation happens while its body is still being read", async () => {
    let current = true;
    let calls = 0;
    let finish!: (body: unknown) => void;
    const response = new Response(null, { status: 401 });
    response.json = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    onUnauthorized(() => {
      calls += 1;
    });
    try {
      const pending = readApiError(response, "無法辨識", () => current);
      current = false;
      finish({ error: { code: "UNAUTHORIZED", requestId: "late-401" } });
      expect((await pending).details.requestId).toBe("late-401");
      expect(calls).toBe(0);
    } finally {
      onUnauthorized(undefined);
    }
  });
});
