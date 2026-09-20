import type { APIEvent } from "@solidjs/start/server";
import { hasValidSession } from "~/lib/server/auth";
import { isSameOrigin, json } from "~/lib/server/http";
import { ACCEPTED_IMAGE_TYPES, createGeminiUpload, MAX_UPLOAD_BYTES } from "~/lib/server/uploads";

export async function POST({ request }: APIEvent) {
  if (!isSameOrigin(request)) return json({ error: "INVALID_ORIGIN" }, { status: 403 });
  if (!(await hasValidSession(request))) return json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return json({ error: "INVALID_CONTENT_TYPE" }, { status: 415 });
  let body: { mimeType?: unknown; sizeBytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (typeof body.mimeType !== "string" || !ACCEPTED_IMAGE_TYPES.has(body.mimeType))
    return json({ error: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  if (!Number.isSafeInteger(body.sizeBytes) || Number(body.sizeBytes) <= 0)
    return json({ error: "INVALID_SIZE" }, { status: 400 });
  if (Number(body.sizeBytes) > MAX_UPLOAD_BYTES)
    return json({ error: "FILE_TOO_LARGE" }, { status: 413 });
  try {
    return json(await createGeminiUpload(body.mimeType, Number(body.sizeBytes)));
  } catch (error) {
    console.error(
      "Unable to create upload session",
      error instanceof Error ? error.message : "unknown error",
    );
    return json({ error: "UPLOAD_UNAVAILABLE" }, { status: 503 });
  }
}
