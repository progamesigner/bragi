import type { APIEvent } from "@solidjs/start/server";
import { hasValidSession } from "~/lib/server/auth";
import { apiError, createRequestId, isSameOrigin } from "~/lib/server/http";
import { observeRequest } from "~/lib/server/observability";
import { verifyUploadId } from "~/lib/server/uploads";

async function handlePOST({ request }: APIEvent) {
  const requestId = createRequestId();
  if (!isSameOrigin(request))
    return apiError(requestId, 403, "INVALID_ORIGIN", "Request origin is not allowed");
  if (!(await hasValidSession(request)))
    return apiError(requestId, 401, "UNAUTHORIZED", "Authentication is required");

  const uploadId = request.headers.get("x-bragi-upload-id");
  if (!uploadId) return apiError(requestId, 400, "INVALID_UPLOAD", "Upload reference is required");

  let upload: Awaited<ReturnType<typeof verifyUploadId>>;
  try {
    upload = await verifyUploadId(uploadId);
  } catch {
    return apiError(requestId, 400, "INVALID_UPLOAD", "Upload reference is invalid or expired");
  }
  if (request.headers.get("content-type") !== upload.mimeType)
    return apiError(
      requestId,
      415,
      "INVALID_CONTENT_TYPE",
      "Image type does not match upload session",
    );

  const body = await request.arrayBuffer();
  if (body.byteLength !== upload.sizeBytes)
    return apiError(requestId, 400, "INVALID_SIZE", "Image size does not match upload session");

  try {
    const response = await fetch(upload.url, {
      method: "POST",
      headers: {
        "content-type": upload.mimeType,
        "x-goog-upload-offset": "0",
        "x-goog-upload-command": "upload, finalize",
      },
      body,
    });
    if (!response.ok) {
      console.error("Gemini upload failed", response.status);
      return apiError(requestId, 503, "UPLOAD_UNAVAILABLE", "Upload service is unavailable", true);
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-type": "application/json",
        "x-request-id": requestId,
      },
    });
  } catch (_error) {
    console.error("Gemini upload unavailable", "unexpected");
    return apiError(requestId, 503, "UPLOAD_UNAVAILABLE", "Upload service is unavailable", true);
  }
}

export function POST(event: APIEvent) {
  return observeRequest(event.request, () => handlePOST(event));
}
