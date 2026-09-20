import type { APIEvent } from "@solidjs/start/server";
import { hasValidSession } from "~/lib/server/auth";
import { isSameOrigin, json } from "~/lib/server/http";
import { verifyUploadId } from "~/lib/server/uploads";

export async function POST({ request }: APIEvent) {
  if (!isSameOrigin(request)) return json({ error: "INVALID_ORIGIN" }, { status: 403 });
  if (!(await hasValidSession(request))) return json({ error: "UNAUTHORIZED" }, { status: 401 });

  const uploadId = request.headers.get("x-bragi-upload-id");
  if (!uploadId) return json({ error: "INVALID_UPLOAD" }, { status: 400 });

  try {
    const upload = await verifyUploadId(uploadId);
    if (request.headers.get("content-type") !== upload.mimeType) {
      return json({ error: "INVALID_CONTENT_TYPE" }, { status: 415 });
    }
    const body = await request.arrayBuffer();
    if (body.byteLength !== upload.sizeBytes) {
      return json({ error: "INVALID_SIZE" }, { status: 400 });
    }

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
      return json({ error: "UPLOAD_UNAVAILABLE" }, { status: 503 });
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
      },
    });
  } catch (error) {
    console.error(
      "Invalid upload request",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "INVALID_UPLOAD" }, { status: 400 });
  }
}
