import "server-only";

export const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { "cache-control": "no-store", ...init.headers } });

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
