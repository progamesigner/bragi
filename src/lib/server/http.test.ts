import { describe, expect, it } from "vitest";
import { apiError, apiJson, createRequestId, isSameOrigin, readCookie } from "./http";

describe("HTTP security helpers", () => {
  it("accepts only an exact same origin", () => {
    expect(
      isSameOrigin(
        new Request("https://bragi.example/api", { headers: { origin: "https://bragi.example" } }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(
        new Request("https://bragi.example/api", { headers: { origin: "https://evil.example" } }),
      ),
    ).toBe(false);
    expect(isSameOrigin(new Request("https://bragi.example/api"))).toBe(false);
  });

  it("reads an exact cookie name", () => {
    const request = new Request("https://bragi.example", {
      headers: { cookie: "a=1; __Host-bragi-session=token; b=2" },
    });
    expect(readCookie(request, "__Host-bragi-session")).toBe("token");
    expect(readCookie(request, "bragi")).toBeUndefined();
  });

  it("returns one request ID in success headers and error bodies", async () => {
    const requestId = createRequestId();
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

    const success = apiJson({ ok: true }, requestId);
    expect(success.headers.get("x-request-id")).toBe(requestId);
    expect(success.headers.get("cache-control")).toBe("private, no-store");

    const failure = apiError(requestId, 400, "INVALID_REQUEST", "Invalid request");
    expect(failure.status).toBe(400);
    expect(failure.headers.get("x-request-id")).toBe(requestId);
    expect(await failure.json()).toEqual({
      error: {
        code: "INVALID_REQUEST",
        message: "Invalid request",
        requestId,
        retryable: false,
      },
    });
  });
});
