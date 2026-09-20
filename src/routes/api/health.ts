import { apiJson, createRequestId } from "~/lib/server/http";

export function GET() {
  const requestId = createRequestId();
  return apiJson({ status: "ok", service: "bragi", requestId }, requestId);
}
