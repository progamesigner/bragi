type ApiErrorBody = {
  error?: {
    message?: unknown;
    requestId?: unknown;
  };
};

export async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    const message = typeof body.error?.message === "string" ? body.error.message : fallback;
    const requestId =
      typeof body.error?.requestId === "string" ? body.error.requestId : String(response.status);
    return `${message} (${requestId})`;
  } catch {
    return `${fallback} (${response.status})`;
  }
}
