export function GET() {
  return Response.json(
    { status: "ok", service: "bragi" },
    { headers: { "cache-control": "no-store" } },
  );
}
