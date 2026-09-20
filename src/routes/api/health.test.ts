import { describe, expect, it } from "vitest";
import { GET } from "./health";

describe("GET /api/health", () => {
  it("returns the shared request identifier", async () => {
    const response = GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.requestId).toBe(response.headers.get("x-request-id"));
  });
});
