import type { APIEvent } from "@solidjs/start/server";
import { ocrRequestSchema, ocrResponseSchema } from "~/lib/schemas";
import { hasValidSession } from "~/lib/server/auth";
import { GeminiError, recognizeImage, resolveGeminiFile } from "~/lib/server/gemini";
import {
  apiError,
  apiJson,
  cancelledResponse,
  createRequestId,
  isSameOrigin,
} from "~/lib/server/http";
import { observeRequest } from "~/lib/server/observability";
import { verifyUploadId } from "~/lib/server/uploads";

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
  const parsed = ocrRequestSchema.safeParse(input);
  if (!parsed.success) return apiError(requestId, 400, "INVALID_REQUEST", "OCR request is invalid");

  let upload: Awaited<ReturnType<typeof verifyUploadId>>;
  try {
    upload = await verifyUploadId(parsed.data.uploadId);
  } catch {
    return apiError(requestId, 400, "INVALID_UPLOAD", "Upload reference is invalid or expired");
  }

  try {
    const file = await resolveGeminiFile(parsed.data.receipt, upload, request.signal);
    const response = ocrResponseSchema.parse(
      await recognizeImage(file, parsed.data.genreHint, request.signal),
    );
    return apiJson(response, requestId);
  } catch (error) {
    if (request.signal.aborted) return cancelledResponse(requestId);
    if (!(error instanceof GeminiError)) {
      console.error("Unexpected OCR failure", "unexpected");
      return apiError(requestId, 503, "OCR_UNAVAILABLE", "OCR service is unavailable", true);
    }
    console.error("Gemini OCR failure", error.kind);
    switch (error.kind) {
      case "invalid-file":
        return apiError(requestId, 400, "INVALID_UPLOAD", "Uploaded image is invalid");
      case "processing":
        return apiError(
          requestId,
          409,
          "UPLOAD_PROCESSING",
          "Uploaded image is still processing",
          true,
        );
      case "rate-limited":
        return apiError(
          requestId,
          429,
          "OCR_RATE_LIMITED",
          "OCR rate limit was reached",
          true,
          error.retryAfter ? { "retry-after": error.retryAfter } : undefined,
        );
      case "rejected":
        return apiError(requestId, 422, "OCR_REJECTED", "Image could not be processed");
      case "invalid-response":
        return apiError(requestId, 502, "OCR_FAILED", "OCR returned an invalid response", true);
      case "unavailable":
        return apiError(requestId, 503, "OCR_UNAVAILABLE", "OCR service is unavailable", true);
    }
  }
}

export function POST(event: APIEvent) {
  return observeRequest(event.request, () => handlePOST(event));
}
