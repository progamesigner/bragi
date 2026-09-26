import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeSpeechStream } from "./speech-stream";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function eventStream(events: unknown[]): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

async function collect(stream: AsyncGenerator<Uint8Array>): Promise<number[]> {
  const chunks: number[] = [];
  for await (const chunk of stream) chunks.push(...chunk);
  return chunks;
}

describe("Gemini speech streaming", () => {
  it("yields validated PCM deltas", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      eventStream([
        { event_type: "interaction.created" },
        {
          event_type: "step.delta",
          delta: { type: "audio", data: Buffer.from([0, 1]).toString("base64") },
        },
        {
          event_type: "step.delta",
          delta: { type: "audio", data: Buffer.from([2, 3]).toString("base64") },
        },
        { event_type: "interaction.completed" },
      ]),
    );

    await expect(
      collect(await synthesizeSpeechStream({ text: "第一段" }, undefined, fetcher)),
    ).resolves.toEqual([0, 1, 2, 3]);
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ "api-revision": "2026-05-20" });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: true,
      store: false,
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: 24_000 },
    });
  });

  it("rejects a completed stream without audio", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(eventStream([{ event_type: "interaction.completed" }]));

    await expect(
      collect(await synthesizeSpeechStream({ text: "第一段" }, undefined, fetcher)),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("maps an upstream rate limit before streaming starts", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429, headers: { "retry-after": "5" } }));

    await expect(
      synthesizeSpeechStream({ text: "第一段" }, undefined, fetcher),
    ).rejects.toMatchObject({ kind: "rate-limited", retryAfter: "5" });
  });
});
