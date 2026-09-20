import type { APIEvent } from "@solidjs/start/server";
import { hasValidSession } from "~/lib/server/auth";
import { isSameOrigin, json } from "~/lib/server/http";

export async function POST({ request }: APIEvent) {
  if (!isSameOrigin(request)) return json({ error: "INVALID_ORIGIN" }, { status: 403 });
  if (!(await hasValidSession(request))) return json({ error: "UNAUTHORIZED" }, { status: 401 });
  return json({ error: "NOT_IMPLEMENTED", milestone: "M5" }, { status: 501 });
}
