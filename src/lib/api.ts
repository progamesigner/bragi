import { type MessageKey, t } from "./i18n";

/** What a failed request leaves behind for support and retry decisions. */
export type ErrorDetails = {
  code?: string;
  status?: number;
  requestId?: string;
  retryable: boolean;
  /** Seconds the server asked us to wait, from `Retry-After`. */
  retryAfter?: number;
};

/**
 * A failed API call. `message` is written for people: the cause and what to do next, in the
 * interface language. The server's own (English, technical) message stays in `serverMessage`.
 */
export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    message: string,
    readonly details: ErrorDetails,
    readonly serverMessage?: string,
  ) {
    super(message);
  }
}

type ApiErrorBody = {
  error?: {
    code?: unknown;
    message?: unknown;
    requestId?: unknown;
    retryable?: unknown;
  };
};

const CODE_MESSAGES: Record<string, MessageKey> = {
  FILE_TOO_LARGE: "apiError.FILE_TOO_LARGE",
  INVALID_CONTENT_TYPE: "apiError.INVALID_REQUEST",
  INVALID_JSON: "apiError.INVALID_REQUEST",
  INVALID_ORIGIN: "apiError.INVALID_ORIGIN",
  INVALID_OTP: "apiError.INVALID_OTP",
  INVALID_REQUEST: "apiError.INVALID_REQUEST",
  INVALID_SIZE: "apiError.INVALID_UPLOAD",
  INVALID_UPLOAD: "apiError.INVALID_UPLOAD",
  OCR_FAILED: "apiError.OCR_FAILED",
  OCR_RATE_LIMITED: "apiError.RATE_LIMITED",
  OCR_REJECTED: "apiError.OCR_REJECTED",
  OCR_UNAVAILABLE: "apiError.OCR_UNAVAILABLE",
  SERVICE_UNAVAILABLE: "apiError.SERVICE_UNAVAILABLE",
  TEXT_TOO_LONG: "apiError.TEXT_TOO_LONG",
  TTS_RATE_LIMITED: "apiError.RATE_LIMITED",
  TTS_REJECTED: "apiError.TTS_REJECTED",
  TTS_UNAVAILABLE: "apiError.TTS_UNAVAILABLE",
  UNAUTHORIZED: "apiError.UNAUTHORIZED",
  UNSUPPORTED_MEDIA_TYPE: "apiError.UNSUPPORTED_MEDIA_TYPE",
  UPLOAD_PROCESSING: "apiError.UPLOAD_PROCESSING",
  UPLOAD_UNAVAILABLE: "apiError.UPLOAD_UNAVAILABLE",
};

let unauthorized: (() => void) | undefined;

/** Expired sessions need reauthentication; an incorrect one-time code stays with the form. */
export function needsSignIn(details?: ErrorDetails): boolean {
  return details?.status === 401 && details.code !== "INVALID_OTP";
}

/**
 * Called whenever an API answers 401 for an expired or missing session (not a wrong one-time
 * code), so the app can ask for sign-in again without losing the draft or the screen.
 */
export function onUnauthorized(handler: (() => void) | undefined): void {
  unauthorized = handler;
}

/** Accepts both forms of `Retry-After`: delay seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

/** Reads the error body. Cancelled operations must not expire a newer session or request. */
export async function readApiError(
  response: Response,
  fallback: string,
  isCurrent: () => boolean = () => true,
): Promise<ApiError> {
  let body: ApiErrorBody["error"];
  try {
    body = ((await response.json()) as ApiErrorBody).error;
  } catch {}
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const code = text(body?.code);
  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
  const details: ErrorDetails = {
    code,
    status: response.status,
    requestId: text(body?.requestId) ?? response.headers.get("x-request-id") ?? undefined,
    retryable:
      typeof body?.retryable === "boolean"
        ? body.retryable
        : response.status === 429 || response.status >= 500,
    retryAfter,
  };
  if (isCurrent() && needsSignIn(details)) unauthorized?.();
  const known = code ? CODE_MESSAGES[code] : undefined;
  let message = known
    ? t(known)
    : t(details.retryable ? "apiError.fallbackRetry" : "apiError.fallback", { cause: fallback });
  if (retryAfter !== undefined) message += t("apiError.retryAfter", { s: retryAfter });
  return new ApiError(message, details, text(body?.message));
}
