import type { APIEvent } from "@solidjs/start/server";
import { sessionRequestSchema } from "~/lib/schemas";
import { expiredSessionCookie, issueSession, sessionCookie, verifyTotp } from "~/lib/server/auth";
import { apiError, apiJson, createRequestId, isSameOrigin } from "~/lib/server/http";

export async function POST({ request }: APIEvent) {
  const requestId = createRequestId();
  if (!isSameOrigin(request))
    return apiError(requestId, 403, "INVALID_ORIGIN", "Request origin is not allowed");
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
  const parsed = sessionRequestSchema.safeParse(body);
  if (!parsed.success)
    return apiError(requestId, 400, "INVALID_REQUEST", "A 6-digit OTP is required");

  try {
    if (!verifyTotp(parsed.data.otp))
      return apiError(requestId, 401, "INVALID_OTP", "OTP is invalid or expired");
    const token = await issueSession();
    return apiJson({ authenticated: true }, requestId, {
      headers: { "set-cookie": sessionCookie(token) },
    });
  } catch (error) {
    console.error(
      "Session authentication unavailable",
      error instanceof Error ? error.message : "unknown error",
    );
    return apiError(requestId, 503, "SERVICE_UNAVAILABLE", "Authentication is unavailable");
  }
}

export function DELETE({ request }: APIEvent) {
  const requestId = createRequestId();
  if (!isSameOrigin(request))
    return apiError(requestId, 403, "INVALID_ORIGIN", "Request origin is not allowed");
  return apiJson({ authenticated: false }, requestId, {
    headers: { "set-cookie": expiredSessionCookie() },
  });
}
