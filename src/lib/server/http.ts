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
  | "SERVICE_UNAVAILABLE"
  | "TEXT_TOO_LONG"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_MEDIA_TYPE"
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
