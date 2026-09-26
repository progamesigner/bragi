import "server-only";
import { z } from "zod";
import type { TtsRequest } from "../schemas";
import { requiredEnv } from "./config";
import { SPEECH_RESPONSE_FORMAT, SpeechError, speechInput, speechModel } from "./speech";
import { resolveVoice } from "./voices";

const INTERACTIONS_STREAM_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse";
const MAX_PCM_BYTES = 24_000 * 2 * 60;

const streamEventSchema = z
  .object({
    event_type: z.string(),
    delta: z
      .object({
        type: z.string(),
        data: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function decodeAudioDelta(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1)
    throw new SpeechError("invalid-response", "Gemini returned invalid streaming audio data");
  const buffer = Buffer.from(value, "base64");
  if (buffer.byteLength === 0)
    throw new SpeechError("invalid-response", "Gemini returned an empty audio chunk");
  return Uint8Array.from(buffer);
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value, { stream: !result.done });
      buffer = buffer.replaceAll("\r\n", "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) yield data;
        boundary = buffer.indexOf("\n\n");
      }

      if (result.done) break;
    }
    const data = buffer
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) yield data;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function upstreamError(response: Response): SpeechError {
  if (response.status === 429)
    return new SpeechError(
      "rate-limited",
      "Gemini speech rate limit was reached",
      response.headers.get("retry-after") ?? undefined,
    );
  if ([400, 422].includes(response.status))
    return new SpeechError("rejected", `Gemini rejected the speech stream (${response.status})`);
  return new SpeechError(
    "unavailable",
    `Gemini speech stream failed (${response.status})`,
    undefined,
    response.status >= 500,
  );
}

export async function synthesizeSpeechStream(
  input: TtsRequest,
  requestSignal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<AsyncGenerator<Uint8Array<ArrayBuffer>, void, undefined>> {
  const timeout = AbortSignal.timeout(55_000);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetcher(INTERACTIONS_STREAM_URL, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "api-revision": "2026-05-20",
        "content-type": "application/json",
        "x-goog-api-key": requiredEnv("GEMINI_API_KEY"),
      },
      body: JSON.stringify({
        model: speechModel(),
        store: false,
        stream: true,
        input: speechInput(input),
        response_format: SPEECH_RESPONSE_FORMAT,
        generation_config: {
          speech_config: [{ voice: resolveVoice(input.voice) }],
        },
      }),
      signal,
    });
  } catch {
    throw new SpeechError("unavailable", "Gemini speech stream could not start");
  }

  if (!response.ok) throw upstreamError(response);
  if (!response.body) throw new SpeechError("invalid-response", "Gemini returned no speech stream");

  return (async function* () {
    let bytes = 0;
    for await (const data of sseData(response.body as ReadableStream<Uint8Array>)) {
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        throw new SpeechError("invalid-response", "Gemini returned an invalid stream event");
      }
      const event = streamEventSchema.safeParse(value);
      if (!event.success)
        throw new SpeechError("invalid-response", "Gemini returned an invalid stream event");
      if (event.data.event_type === "interaction.failed")
        throw new SpeechError("unavailable", "Gemini speech streaming failed");
      if (event.data.event_type !== "step.delta" || event.data.delta?.type !== "audio") continue;
      if (!event.data.delta.data) continue;

      const chunk = decodeAudioDelta(event.data.delta.data);
      bytes += chunk.byteLength;
      if (bytes > MAX_PCM_BYTES)
        throw new SpeechError("too-long", "Generated speech exceeds 60 seconds");
      yield chunk;
    }

    if (bytes === 0)
      throw new SpeechError("invalid-response", "Gemini returned no streaming audio");
    if (bytes % 2 !== 0)
      throw new SpeechError("invalid-response", "Gemini returned incomplete streaming PCM audio");
  })();
}
