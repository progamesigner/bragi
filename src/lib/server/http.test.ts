import { describe, expect, it } from "vitest";
import { isSameOrigin, readCookie } from "./http";

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
      headers: { cookie: "a=1; __Host-bragi=token; b=2" },
    });
    expect(readCookie(request, "__Host-bragi")).toBe("token");
    expect(readCookie(request, "bragi")).toBeUndefined();
  });
});
