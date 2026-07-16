export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
} as const;

export function GET(): Response {
  return Response.json(
    { status: "ok" },
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    },
  );
}
