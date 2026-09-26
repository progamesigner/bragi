import "server-only";

function bucket(size: number): string {
  return size <= 0 ? "unknown" : size < 10_000 ? "small" : size < 1_000_000 ? "medium" : "large";
}

export async function observeRequest(
  request: Request,
  run: () => Response | Promise<Response>,
): Promise<Response> {
  const start = performance.now();
  const endpoint = new URL(request.url).pathname;
  const response = await run();
  const requestId = response.headers.get("x-request-id");
  const model =
    endpoint === "/api/ocr"
      ? process.env.GEMINI_OCR_MODEL || "gemini-3.8-flash"
      : endpoint.startsWith("/api/tts")
        ? process.env.GEMINI_TTS_MODEL || "gemini-3.1-flash-tts-preview"
        : undefined;
  const log = (outcome: string, bytes = 0) =>
    console.info(
      JSON.stringify({
        event: "bragi.request",
        time: new Date().toISOString(),
        endpoint,
        method: request.method,
        requestId,
        model: model && /^[a-zA-Z0-9._-]{1,80}$/.test(model) ? model : undefined,
        status: response.status,
        latencyMs: Math.round(performance.now() - start),
        inputSize: bucket(Number(request.headers.get("content-length"))),
        audioSeconds: endpoint.startsWith("/api/tts")
          ? Math.round((bytes / 48_000) * 100) / 100
          : undefined,
        purpose: ["preview", "playback", "prefetch"].includes(
          request.headers.get("x-bragi-speech-purpose") ?? "",
        )
          ? request.headers.get("x-bragi-speech-purpose")
          : undefined,
        streaming: endpoint === "/api/tts-stream",
        outcome,
      }),
    );
  if (!response.body || !response.ok || !endpoint.startsWith("/api/tts")) {
    log(response.ok ? "complete" : response.status === 499 ? "cancelled" : "error");
    return response;
  }
  const reader = response.body.getReader();
  let bytes = 0;
  let logged = false;
  const finish = (outcome: string) => {
    if (!logged) {
      logged = true;
      log(outcome, endpoint === "/api/tts" ? Math.max(0, bytes - 44) : bytes);
    }
  };
  return new Response(
    new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) {
            finish("complete");
            controller.close();
          } else {
            bytes += result.value.byteLength;
            controller.enqueue(result.value);
          }
        } catch (error) {
          finish("interrupted");
          controller.error(error);
        }
      },
      async cancel(reason) {
        finish("cancelled");
        await reader.cancel(reason);
      },
    }),
    { status: response.status, headers: response.headers },
  );
}
