import type { APIEvent } from "@solidjs/start/server";
import { ocrRequestSchema, ocrResponseSchema } from "~/lib/schemas";
import { hasValidSession } from "~/lib/server/auth";
import { apiError, apiJson, createRequestId, isSameOrigin } from "~/lib/server/http";
import { verifyUploadId } from "~/lib/server/uploads";

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
  const parsed = ocrRequestSchema.safeParse(input);
  if (!parsed.success) return apiError(requestId, 400, "INVALID_REQUEST", "OCR request is invalid");

  try {
    await verifyUploadId(parsed.data.uploadId);
  } catch {
    return apiError(requestId, 400, "INVALID_UPLOAD", "Upload reference is invalid or expired");
  }

  const response = ocrResponseSchema.parse({
    detectedLanguage: "zh-Hant",
    segments: [
      {
        id: "segment-1",
        text: "這是一段用於驗證 Bragi 流程的範例文字。",
        suggestedToneHint: "清晰、沉穩地敘述",
      },
      {
        id: "segment-2",
        text: "確認內容後，即可逐段進行朗讀。",
        suggestedToneHint: "帶有期待感",
      },
    ],
  });
  return apiJson(response, requestId);
}
