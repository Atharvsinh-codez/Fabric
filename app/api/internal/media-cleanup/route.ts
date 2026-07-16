import { hasValidReadinessSecret } from "@/lib/health/readiness-secret";
import { runMediaCleanup } from "@/lib/storage/r2/cleanup-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
} as const;

function unavailable(status: 401 | 503): Response {
  return Response.json(
    { status: "unavailable" },
    { status, headers: NO_STORE_HEADERS },
  );
}

/** Authenticated GET is compatible with hosted cron schedulers and manual probes. */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.MEDIA_CLEANUP_SECRET;
  if (!secret || secret.length < 32) {
    console.error("[media-cleanup] MEDIA_CLEANUP_SECRET is not configured securely.");
    return unavailable(503);
  }
  if (!hasValidReadinessSecret(request.headers.get("authorization"), secret)) {
    return unavailable(401);
  }

  try {
    return Response.json(
      { status: "ok", ...(await runMediaCleanup()) },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("[media-cleanup] Bounded cleanup run failed.");
    return unavailable(503);
  }
}
