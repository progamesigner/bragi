export function requireOnline(): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("目前離線，請連線後再重試；尚未送出請求。");
  }
}

export function networkErrorMessage(error: unknown, fallback: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "網路已中斷，請連線後手動重試。";
  }
  if (error instanceof TypeError) return "無法連線至服務，請確認網路後手動重試。";
  return error instanceof Error ? error.message : fallback;
}
