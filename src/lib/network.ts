import { ApiError, type ErrorDetails } from "./api";
import { t } from "./i18n";

export function requireOnline(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error(t("network.offlineBeforeRequest"));
  }
}

export type DescribedError = {
  message: string;
  details?: ErrorDetails;
};

/** Turns any thrown value into a sentence for people plus, for API failures, its details. */
export function describeError(error: unknown, fallback: string): DescribedError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { message: t("network.disconnected") };
  }
  if (error instanceof TypeError) return { message: t("network.unreachable") };
  if (error instanceof ApiError) return { message: error.message, details: error.details };
  return { message: error instanceof Error ? error.message : fallback };
}
