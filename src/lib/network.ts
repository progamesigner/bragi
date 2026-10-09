import { t } from "./i18n";

export function requireOnline(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error(t("network.offlineBeforeRequest"));
  }
}

export function networkErrorMessage(error: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return t("network.disconnected");
  }
  if (error instanceof TypeError) return t("network.unreachable");
  return error instanceof Error ? error.message : fallback;
}
