import { hasValidReadinessSecret } from "@/lib/health/readiness-secret";
import { getRealtimeRevocationDispatchEnvironment } from "@/lib/realtime/revocation-dispatch-environment";
import { runRealtimeRevocationDispatch } from "@/lib/realtime/revocation-dispatcher";

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

/** Authenticated GET supports hosted cron schedulers and bounded manual replay. */
export async function GET(request: Request): Promise<Response> {
  let dispatchSecret: string;
  try {
    dispatchSecret = getRealtimeRevocationDispatchEnvironment().dispatchSecret;
  } catch {
    console.error("[realtime-revocations] Dispatcher environment is not configured securely.");
    return unavailable(503);
  }

  if (!hasValidReadinessSecret(request.headers.get("authorization"), dispatchSecret)) {
    return unavailable(401);
  }

  try {
    return Response.json(
      { status: "ok", ...(await runRealtimeRevocationDispatch()) },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    console.error("[realtime-revocations] Bounded dispatch run failed.");
    return unavailable(503);
  }
}
