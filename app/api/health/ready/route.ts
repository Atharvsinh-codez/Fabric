import { sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import {
  getFabricReadinessTopology,
  getReadyWorkspaceRolloutMode,
  hasReadyPrivateMediaConfiguration,
  hasReadyRealtimeRevocationConfiguration,
  hasReadyServerlessAiConfiguration,
  probeExternalRealtime,
} from "@/lib/health/deployment-readiness";
import { hasValidReadinessSecret } from "@/lib/health/readiness-secret";
import { getFabricRuntimeStatus } from "@/lib/health/runtime-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-cache, no-store, max-age=0, must-revalidate",
} as const;

function unavailable(status: 401 | 503): Response {
  return Response.json(
    { status: "unavailable" },
    {
      status,
      headers: NO_STORE_HEADERS,
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  const configuredSecret = process.env.HEALTHCHECK_SECRET;
  if (!configuredSecret || configuredSecret.length < 32) {
    console.error("[health/ready] HEALTHCHECK_SECRET is not configured securely.");
    return unavailable(503);
  }

  if (!hasValidReadinessSecret(request.headers.get("authorization"), configuredSecret)) {
    return unavailable(401);
  }

  try {
    await db.execute(sql`select 1`);
  } catch {
    console.error("[health/ready] Database connectivity check failed.");
    return unavailable(503);
  }

  const topology = getFabricReadinessTopology(process.env);
  const workspaceRolloutMode = getReadyWorkspaceRolloutMode(process.env);
  if (!workspaceRolloutMode) {
    console.error("[health/ready] Workspace rollout configuration is invalid.");
    return unavailable(503);
  }
  if (topology === "vercel-serverless") {
    const [realtimeReady, aiReady, mediaReady, revocationsReady] = await Promise.all([
      probeExternalRealtime({
        configuredRealtimeUrl: process.env.NEXT_PUBLIC_REALTIME_URL,
      }),
      Promise.resolve(hasReadyServerlessAiConfiguration(process.env)),
      Promise.resolve(hasReadyPrivateMediaConfiguration(process.env)),
      Promise.resolve(hasReadyRealtimeRevocationConfiguration(process.env)),
    ]);
    if (!realtimeReady || !aiReady || !mediaReady || !revocationsReady) {
      console.error(
        "[health/ready] One or more external production services are not ready.",
      );
      return unavailable(503);
    }

    return Response.json(
      {
        status: "ready",
        topology: "vercel-serverless",
        services: {
          web: "ready",
          realtime: "external-ready",
          revocations: "coordinator-ready",
          aiWorker: "serverless-ready",
          media: "private-r2-ready",
          workspaceRollout: `${workspaceRolloutMode}-ready`,
        },
        acceptingAiRuns: true,
      },
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const runtime = getFabricRuntimeStatus();
  if (
    runtime.shuttingDown ||
    !runtime.web ||
    !runtime.realtime ||
    !runtime.aiWorker ||
    !hasReadyPrivateMediaConfiguration(process.env)
  ) {
    console.error("[health/ready] One or more single-origin runtimes are not ready.");
    return unavailable(503);
  }

  return Response.json(
    {
      status: "ready",
      services: {
        web: "ready",
        realtime: "ready",
        aiWorker: "ready",
        media: "private-r2-ready",
        workspaceRollout: `${workspaceRolloutMode}-ready`,
      },
      acceptingAiRuns: runtime.acceptingAiRuns,
    },
    {
      status: 200,
      headers: NO_STORE_HEADERS,
    },
  );
}
