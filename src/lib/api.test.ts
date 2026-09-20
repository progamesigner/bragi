import { describe, expect, it } from "vitest";
import { apiErrorMessage } from "./api";

describe("API error messages", () => {
  it("preserves a safe server message and request ID", async () => {
    const response = Response.json(
      { error: { message: "OTP is invalid or expired", requestId: "request-1" } },
      { status: 401 },
    );

    await expect(apiErrorMessage(response, "登入失敗")).resolves.toBe(
      "OTP is invalid or expired (request-1)",
    );
  });

  it("falls back to the HTTP status for an invalid body", async () => {
    const response = new Response("upstream error", { status: 502 });
    await expect(apiErrorMessage(response, "服務暫時無法使用")).resolves.toBe(
      "服務暫時無法使用 (502)",
    );
  });
});
