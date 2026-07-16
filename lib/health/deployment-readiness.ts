import { isIP } from "node:net";

import { parseR2Environment } from "@/lib/storage/r2/environment";
import { getRealtimeRevocationDispatchEnvironment } from "@/lib/realtime/revocation-dispatch-environment";
import {
  parseWorkspaceRolloutEnvironment,
  type WorkspaceRolloutMode,
} from "@/lib/rollout/workspace-rollout-policy";
import { loadServerlessWorkerConfig } from "@/worker/config";

export type FabricReadinessTopology = "attached" | "vercel-serverless";

const REALTIME_HEALTH_TIMEOUT_MS = 4_000;
const MAX_HEALTH_RESPONSE_BYTES = 1_024;

export function getFabricReadinessTopology(
  environment: Record<string, string | undefined>,
): FabricReadinessTopology {
  return environment.VERCEL === "1" ? "vercel-serverless" : "attached";
}

export function deriveExternalRealtimeHealthUrl(
  configuredRealtimeUrl: string | undefined,
): URL | null {
  if (!configuredRealtimeUrl) return null;
  try {
    const realtime = new URL(configuredRealtimeUrl);
    const hostname = realtime.hostname.toLowerCase();
    if (
      realtime.protocol !== "wss:" ||
      realtime.pathname !== "/realtime" ||
      realtime.username ||
      realtime.password ||
      realtime.search ||
      realtime.hash ||
      (realtime.port && realtime.port !== "443") ||
      !hostname.includes(".") ||
      hostname === "localhost" ||
      hostname.endsWith(".local") ||
      isIP(hostname) !== 0
    ) {
      return null;
    }

    const health = new URL(realtime.toString());
    health.protocol = "https:";
    health.pathname = "/health";
    return health;
  } catch {
    return null;
  }
}

export async function probeExternalRealtime(input: {
  configuredRealtimeUrl: string | undefined;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}): Promise<boolean> {
  const healthUrl = deriveExternalRealtimeHealthUrl(
    input.configuredRealtimeUrl,
  );
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  if (!healthUrl || typeof fetchImplementation !== "function") return false;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? REALTIME_HEALTH_TIMEOUT_MS,
  );
  try {
    const response = await fetchImplementation(healthUrl, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_HEALTH_RESPONSE_BYTES
    ) {
      return false;
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_HEALTH_RESPONSE_BYTES) {
      return false;
    }
    const payload = JSON.parse(text) as unknown;
    return Boolean(
      payload &&
        typeof payload === "object" &&
        "status" in payload &&
        payload.status === "ok" &&
        "transport" in payload &&
        payload.transport === "cloudflare-durable-objects",
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export function hasReadyServerlessAiConfiguration(
  environment: Record<string, string | undefined>,
): boolean {
  try {
    return loadServerlessWorkerConfig(environment).runsEnabled;
  } catch {
    return false;
  }
}

export function hasReadyRealtimeRevocationConfiguration(
  environment: Record<string, string | undefined>,
): boolean {
  try {
    const configuration = getRealtimeRevocationDispatchEnvironment(environment);
    const healthUrl = deriveExternalRealtimeHealthUrl(
      environment.NEXT_PUBLIC_REALTIME_URL,
    );
    const endpoint = new URL(configuration.endpoint);
    const signingKey = environment.REALTIME_TICKET_SIGNING_KEY?.trim() ?? "";
    const readinessSecret = environment.HEALTHCHECK_SECRET?.trim() ?? "";
    return (
      Boolean(healthUrl) &&
      endpoint.origin === healthUrl?.origin &&
      endpoint.pathname === "/internal/revocations" &&
      !/(?:replace|change|placeholder|example)/i.test(
        `${configuration.coordinatorSecret}:${configuration.dispatchSecret}`,
      ) &&
      configuration.coordinatorSecret !== signingKey &&
      configuration.dispatchSecret !== signingKey &&
      configuration.coordinatorSecret !== readinessSecret &&
      configuration.dispatchSecret !== readinessSecret
    );
  } catch {
    return false;
  }
}

export function hasReadyPrivateMediaConfiguration(
  environment: Record<string, string | undefined>,
): boolean {
  try {
    parseR2Environment(environment);
    const cleanupSecret = environment.MEDIA_CLEANUP_SECRET?.trim() ?? "";
    return (
      cleanupSecret.length >= 32 &&
      !/(?:replace|change|placeholder|example)/i.test(cleanupSecret)
    );
  } catch {
    return false;
  }
}

export function getReadyWorkspaceRolloutMode(
  environment: Record<string, string | undefined>,
): WorkspaceRolloutMode | null {
  try {
    return parseWorkspaceRolloutEnvironment(environment).mode;
  } catch {
    return null;
  }
}
