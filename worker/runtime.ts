import { GeminiInteractionsProvider } from "../lib/ai/providers/gemini";

import { loadWorkerConfig } from "./config";
import { createWorkerDatabase } from "./database";
import { processClaimedAiJob } from "./processor";
import {
  claimNextAiJob,
  cleanupAiRetention,
  listExpiredActiveRunIds,
  recordRunCanceled,
} from "./repository";

export type AiWorkerRuntime = Readonly<{
  acceptingRuns: boolean;
  ready: () => Promise<boolean>;
  stop: (signal: string) => Promise<void>;
}>;

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function startAiWorkerRuntime(
  environment: Record<string, string | undefined> = process.env,
): Promise<AiWorkerRuntime> {
  const config = loadWorkerConfig(environment);
  const sql = createWorkerDatabase(config.databaseUrl);
  const provider = new GeminiInteractionsProvider(config.ai);
  let shuttingDown = false;
  let lastCleanupAt = 0;
  let stopPromise: Promise<void> | null = null;

  const ready = async (): Promise<boolean> => {
    if (shuttingDown) return false;
    try {
      await sql`
        select run.id
        from ai_runs as run
        inner join ai_jobs as job on job.run_id = run.id
        inner join boards as board on board.id = run.board_id
        where false
      `;
      return true;
    } catch {
      return false;
    }
  };

  if (!(await ready())) {
    await sql.end({ timeout: 5 });
    throw new Error("The Fabric AI worker database or grants are not ready.");
  }

  const performMaintenance = async (now: Date): Promise<void> => {
    const expiredRunIds = await listExpiredActiveRunIds(sql, now);
    for (const runId of expiredRunIds) {
      await recordRunCanceled(sql, { runId, reason: "deadline_exceeded", now });
    }

    if (now.getTime() - lastCleanupAt < config.cleanupIntervalMs) return;
    lastCleanupAt = now.getTime();
    await cleanupAiRetention(sql, {
      eventCutoff: new Date(now.getTime() - config.eventRetentionDays * 86_400_000),
      runCutoff: new Date(now.getTime() - config.runRetentionDays * 86_400_000),
    });
  };

  const runLoop = async (): Promise<void> => {
    while (!shuttingDown) {
      try {
        const now = new Date();
        await performMaintenance(now);
        if (!config.runsEnabled) {
          await delay(config.pollMs);
          continue;
        }
        const job = await claimNextAiJob(sql, {
          workerId: config.workerId,
          leaseMs: config.leaseMs,
          now,
        });
        if (!job) {
          await delay(config.pollMs);
          continue;
        }
        console.info(`Fabric AI worker claimed run ${job.runId} attempt ${job.attempt}.`);
        await processClaimedAiJob({ sql, job, provider, leaseMs: config.leaseMs });
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        console.error(`Fabric AI worker loop error: ${errorName}.`);
        await delay(Math.min(5_000, config.pollMs * 4));
      }
    }
  };

  const loop = runLoop();

  const stop = (signal: string): Promise<void> => {
    if (stopPromise) return stopPromise;
    shuttingDown = true;
    console.info(`Fabric AI worker received ${signal}; draining the active lease.`);
    stopPromise = Promise.race([loop, delay(55_000)]).then(async () => {
      await sql.end({ timeout: 5 });
    });
    return stopPromise;
  };

  return Object.freeze({ acceptingRuns: config.runsEnabled, ready, stop });
}
