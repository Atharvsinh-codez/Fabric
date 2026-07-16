import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  APPROVED_GEMINI_MODEL,
  parseAiRuntimeConfig,
  parseGeminiApiKeys,
} from "../lib/ai/config";
import { MAX_BOARD_ASSISTANCE_WALL_TIME_MS } from "../lib/ai/skills/board-assistance.v1";

const WorkerEnvironmentSchema = z
  .object({
    WORKER_DATABASE_URL: z
      .string()
      .trim()
      .url()
      .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://")),
    GEMINI_API_KEYS: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.literal(APPROVED_GEMINI_MODEL).default(APPROVED_GEMINI_MODEL),
    GEMINI_STORE_INTERACTIONS: z.enum(["false", "FALSE", "False"]).default("false"),
    AI_RUNS_ENABLED: z.enum(["true", "false"]).default("false"),
    AI_WORKER_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
    AI_WORKER_LEASE_MS: z.coerce.number().int().min(30_000).max(300_000).default(60_000),
    AI_EVENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    AI_RUN_RETENTION_DAYS: z.coerce.number().int().min(7).max(365).default(30),
    AI_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(3_600_000),
  })
  .passthrough();

export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;

function parseWorkerEnvironment(
  environment: Record<string, string | undefined>,
  allowSharedWebDatabase: boolean,
) {
  const parsed = WorkerEnvironmentSchema.parse(environment);
  const webDatabaseUrl = environment.DATABASE_URL?.trim();
  if (
    !allowSharedWebDatabase &&
    webDatabaseUrl &&
    webDatabaseUrl === parsed.WORKER_DATABASE_URL
  ) {
    throw new Error("WORKER_DATABASE_URL must use a distinct least-privilege worker credential.");
  }

  const ai = parseAiRuntimeConfig({
    apiKeys: parseGeminiApiKeys(parsed),
    model: parsed.GEMINI_MODEL,
    storeInteractions: false,
    requestTimeoutMs: MAX_BOARD_ASSISTANCE_WALL_TIME_MS,
  });

  return Object.freeze({
    databaseUrl: parsed.WORKER_DATABASE_URL,
    ai,
    runsEnabled: parsed.AI_RUNS_ENABLED === "true",
    pollMs: parsed.AI_WORKER_POLL_MS,
    leaseMs: parsed.AI_WORKER_LEASE_MS,
    eventRetentionDays: parsed.AI_EVENT_RETENTION_DAYS,
    runRetentionDays: parsed.AI_RUN_RETENTION_DAYS,
    cleanupIntervalMs: parsed.AI_CLEANUP_INTERVAL_MS,
    workerId: `${hostname()}:${process.pid}:${randomUUID()}`,
  });
}

export function loadWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  return parseWorkerEnvironment(environment, false);
}

export function loadServerlessWorkerConfig(
  environment: Record<string, string | undefined> = process.env,
) {
  const configuredWorkerUrl = environment.WORKER_DATABASE_URL?.trim();
  const sharedWebUrl = environment.VERCEL === "1"
    ? environment.DATABASE_URL?.trim()
    : undefined;
  return parseWorkerEnvironment(
    {
      ...environment,
      WORKER_DATABASE_URL: configuredWorkerUrl || sharedWebUrl,
    },
    !configuredWorkerUrl && Boolean(sharedWebUrl),
  );
}
