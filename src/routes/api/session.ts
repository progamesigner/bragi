import type { APIEvent } from "@solidjs/start/server";
import { expiredSessionCookie, issueSession, sessionCookie, verifyTotp } from "~/lib/server/auth";
import { isSameOrigin, json } from "~/lib/server/http";

export async function POST({ request }: APIEvent) {
  if (!isSameOrigin(request)) return json({ error: "INVALID_ORIGIN" }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return json({ error: "INVALID_CONTENT_TYPE" }, { status: 415 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const otp =
    typeof body === "object" && body !== null && "otp" in body
      ? (body as { otp?: unknown }).otp
      : undefined;
  if (typeof otp !== "string" || !verifyTotp(otp))
    return json({ error: "INVALID_OTP" }, { status: 401 });
  const token = await issueSession();
  return json({ authenticated: true }, { headers: { "set-cookie": sessionCookie(token) } });
}

export function DELETE({ request }: APIEvent) {
  if (!isSameOrigin(request)) return json({ error: "INVALID_ORIGIN" }, { status: 403 });
  return json({ authenticated: false }, { headers: { "set-cookie": expiredSessionCookie() } });
}
