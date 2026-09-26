import { afterEach, expect, it, vi } from "vitest";
import { observeRequest } from "./observability";

afterEach(() => vi.restoreAllMocks());

it("logs stream completion without request text, credentials or response bytes", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const request = new Request("https://bragi.example/api/tts-stream?private=secret", {
    method: "POST",
    body: "private transcript",
    headers: { cookie: "private cookie", "x-bragi-speech-purpose": "prefetch" },
  });
  const response = await observeRequest(
    request,
    () => new Response(new Uint8Array(48_000), { headers: { "x-request-id": "test" } }),
  );
  expect(log).not.toHaveBeenCalled();
  await response.arrayBuffer();
  const entry = JSON.parse(log.mock.calls[0]?.[0] as string);
  expect(entry).toMatchObject({
    endpoint: "/api/tts-stream",
    requestId: "test",
    audioSeconds: 1,
    outcome: "complete",
    purpose: "prefetch",
  });
  expect(JSON.stringify(entry)).not.toMatch(/private|secret|cookie|transcript/);
});

it("records streaming interruptions even after HTTP success", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = await observeRequest(
    new Request("https://bragi.example/api/tts-stream"),
    () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("private provider content"));
          },
        }),
      ),
  );
  await expect(response.arrayBuffer()).rejects.toThrow();
  expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
    status: 200,
    outcome: "interrupted",
  });
  expect(log.mock.calls.flat().join()).not.toContain("private");
});

it("records client cancellations separately from errors", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  await observeRequest(new Request("https://bragi.example/api/ocr", { method: "POST" }), () =>
    Response.json({ error: { code: "REQUEST_CANCELLED" } }, { status: 499 }),
  );
  expect(JSON.parse(log.mock.calls[0]?.[0] as string)).toMatchObject({
    status: 499,
    outcome: "cancelled",
  });
});
