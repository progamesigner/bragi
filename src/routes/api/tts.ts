import type { APIEvent } from "@solidjs/start/server";
import { isTtsTextTooLong, ttsRequestSchema } from "~/lib/schemas";
import { hasValidSession } from "~/lib/server/auth";
import { apiError, createRequestId, isSameOrigin } from "~/lib/server/http";
import { createTestWav } from "~/lib/wav";

export async function POST({ request }: APIEvent) {
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

  const wav = createTestWav();
  return new Response(wav.buffer, {
    status: 200,
    headers: {
      "cache-control": "private, no-store",
      "content-length": String(wav.byteLength),
      "content-type": "audio/wav",
      "x-audio-duration-ms": "300",
      "x-request-id": requestId,
    },
  });
}
