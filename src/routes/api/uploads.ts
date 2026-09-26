import type { APIEvent } from "@solidjs/start/server";
import { uploadSessionRequestSchema } from "~/lib/schemas";
import { hasValidSession } from "~/lib/server/auth";
import { apiError, apiJson, createRequestId, isSameOrigin } from "~/lib/server/http";
import { observeRequest } from "~/lib/server/observability";
import { ACCEPTED_IMAGE_TYPES, createGeminiUpload, MAX_UPLOAD_BYTES } from "~/lib/server/uploads";

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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(requestId, 400, "INVALID_JSON", "Request body must be valid JSON");
  }
  const parsed = uploadSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    const unsupported =
      typeof body === "object" &&
      body !== null &&
      "mimeType" in body &&
      typeof body.mimeType === "string" &&
      !ACCEPTED_IMAGE_TYPES.has(body.mimeType);
    return unsupported
      ? apiError(requestId, 415, "UNSUPPORTED_MEDIA_TYPE", "Image type is not supported")
      : apiError(requestId, 400, "INVALID_REQUEST", "Upload request is invalid");
  }
  if (parsed.data.sizeBytes > MAX_UPLOAD_BYTES)
    return apiError(requestId, 413, "FILE_TOO_LARGE", "Image exceeds the 4 MB upload limit");

  try {
    return apiJson(
      await createGeminiUpload(parsed.data.mimeType, parsed.data.sizeBytes),
      requestId,
    );
  } catch (_error) {
    console.error("Unable to create upload session", "unexpected");
    return apiError(requestId, 503, "UPLOAD_UNAVAILABLE", "Upload service is unavailable", true);
  }
}

export function POST(event: APIEvent) {
  return observeRequest(event.request, () => handlePOST(event));
}
