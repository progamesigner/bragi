import "server-only";

export type ApiErrorCode =
  | "FILE_TOO_LARGE"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_JSON"
  | "INVALID_ORIGIN"
  | "INVALID_OTP"
  | "INVALID_REQUEST"
  | "INVALID_SIZE"
  | "INVALID_UPLOAD"
  | "OCR_FAILED"
  | "OCR_RATE_LIMITED"
  | "OCR_REJECTED"
  | "OCR_UNAVAILABLE"
  | "REQUEST_CANCELLED"
  | "SERVICE_UNAVAILABLE"
  | "TEXT_TOO_LONG"
  | "TTS_RATE_LIMITED"
  | "TTS_REJECTED"
  | "TTS_UNAVAILABLE"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UPLOAD_PROCESSING"
  | "UPLOAD_UNAVAILABLE";

export function createRequestId(): string {
  return crypto.randomUUID();
}

export function apiJson(body: unknown, requestId: string, init: ResponseInit = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      "cache-control": "private, no-store",
      "x-request-id": requestId,
      ...init.headers,
    },
  });
}

export function apiError(
  requestId: string,
  status: number,
  code: ApiErrorCode,
  message: string,
  retryable = false,
  headers?: HeadersInit,
) {
  return apiJson({ error: { code, message, requestId, retryable } }, requestId, {
    status,
    headers,
  });
}

/** Combines a provider timeout with the client's disconnect signal. */
export function withDeadline(milliseconds: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** The client has gone away, so this body is only recorded for logs and tests. */
export function cancelledResponse(requestId: string) {
  return apiError(requestId, 499, "REQUEST_CANCELLED", "Request was cancelled by the client");
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie");
  return cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
