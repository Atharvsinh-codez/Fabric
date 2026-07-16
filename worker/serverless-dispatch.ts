import { OpenAiCompatibleChatProvider } from "../lib/ai/providers/openai-compatible";

import { loadServerlessWorkerConfig } from "./config";
import { createWorkerDatabase } from "./database";
import { processClaimedAiJob } from "./processor";
import { claimAiJobByRunId } from "./repository";

const globalForDispatch = globalThis as typeof globalThis & {
  fabricAiServerlessDispatches?: Map<string, Promise<void>>;
};

const activeDispatches =
  globalForDispatch.fabricAiServerlessDispatches ?? new Map<string, Promise<void>>();

if (process.env.NODE_ENV !== "production") {
  globalForDispatch.fabricAiServerlessDispatches = activeDispatches;
}

function isServerlessDispatchEnabled(
  environment: Record<string, string | undefined>,
): boolean {
  return (
    environment.VERCEL === "1" ||
    environment.AI_SERVERLESS_DISPATCH_ENABLED?.toLowerCase() === "true"
  );
}

async function runServerlessDispatch(
  runId: string,
  environment: Record<string, string | undefined>,
): Promise<void> {
  const config = loadServerlessWorkerConfig(environment);
  if (!config.runsEnabled) throw new Error("AI runs are disabled for this deployment.");

  const sql = createWorkerDatabase(config.databaseUrl, 1);
  try {
    const job = await claimAiJobByRunId(sql, {
      runId,
      workerId: config.workerId,
      leaseMs: config.leaseMs,
    });
    if (!job) return;

    const provider = new OpenAiCompatibleChatProvider(config.ai);
    await processClaimedAiJob({ sql, job, provider, leaseMs: config.leaseMs });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Vercel does not execute Fabric's custom long-running server. Keep the same
 * durable claim/lease processor, but start one bounded invocation for the
 * authenticated run whose SSE response is currently open.
 */
export function dispatchAiRunOnDemand(
  runId: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (!isServerlessDispatchEnabled(environment)) return Promise.resolve();

  const existing = activeDispatches.get(runId);
  if (existing) return existing;

  const dispatch = runServerlessDispatch(runId, environment).finally(() => {
    activeDispatches.delete(runId);
  });
  activeDispatches.set(runId, dispatch);
  return dispatch;
}
