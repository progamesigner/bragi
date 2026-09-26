import type { APIEvent } from "@solidjs/start/server";
import { isTtsTextTooLong, ttsRequestSchema } from "~/lib/schemas";
import { hasValidSession } from "~/lib/server/auth";
import { apiError, cancelledResponse, createRequestId, isSameOrigin } from "~/lib/server/http";
import { observeRequest } from "~/lib/server/observability";
import { SpeechError, synthesizeSpeech } from "~/lib/server/speech";
import { resolveVoice } from "~/lib/server/voices";
import { pcmToWav } from "~/lib/wav";

async function handlePOST({ request }: APIEvent) {
  const requestId = createRequestId();
  if (!isSameOrigin(request))
    return apiError(requestId, 403, "INVALID_ORIGIN", "Request origin is not allowed");
  if (!(await hasValidSession(request)))
    return apiError(requestId, 401, "UNAUTHORIZED", "Authentication is required");
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return apiError(
      requestId,
      415,
      "INVALID_CONTENT_TYPE",
      "Content-Type must be application/json",
    );

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return apiError(requestId, 400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const candidateText =
    typeof input === "object" && input !== null && "text" in input
      ? (input as { text?: unknown }).text
      : undefined;
  if (isTtsTextTooLong(candidateText))
    return apiError(requestId, 413, "TEXT_TOO_LONG", "Text exceeds the speech limit");
  const parsed = ttsRequestSchema.safeParse(input);
  if (!parsed.success)
    return apiError(requestId, 400, "INVALID_REQUEST", "Speech request is invalid");

  try {
    if (parsed.data.voice) resolveVoice(parsed.data.voice);
  } catch {
    return apiError(requestId, 400, "INVALID_REQUEST", "Voice is not allowed");
  }

  try {
    const speech = await synthesizeSpeech(parsed.data, request.signal);
    const wav = pcmToWav(speech.pcm);
    return new Response(wav.buffer, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(wav.byteLength),
        "content-type": "audio/wav",
        "x-audio-duration-ms": String(speech.durationMs),
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    if (request.signal.aborted) return cancelledResponse(requestId);
    if (!(error instanceof SpeechError)) {
      console.error("Unexpected speech failure", "unexpected");
      return apiError(requestId, 503, "TTS_UNAVAILABLE", "Speech service is unavailable", true);
    }
    console.error("Gemini speech failure", error.kind);
    switch (error.kind) {
      case "too-long":
        return apiError(
          requestId,
          413,
          "TEXT_TOO_LONG",
          "Generated speech is too long; split this segment",
        );
      case "rate-limited":
        return apiError(
          requestId,
          429,
          "TTS_RATE_LIMITED",
          "Speech rate limit was reached",
          true,
          error.retryAfter ? { "retry-after": error.retryAfter } : undefined,
        );
      case "rejected":
        return apiError(requestId, 422, "TTS_REJECTED", "Speech request was rejected");
      case "invalid-response":
        return apiError(
          requestId,
          502,
          "TTS_UNAVAILABLE",
          "Speech service returned invalid audio",
          true,
        );
      case "unavailable":
        return apiError(requestId, 503, "TTS_UNAVAILABLE", "Speech service is unavailable", true);
    }
  }
}

export function POST(event: APIEvent) {
  return observeRequest(event.request, () => handlePOST(event));
}
