import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  FABRIC_AI_PROVIDER,
  parseAiApiKeys,
  parseAiRuntimeConfig,
} from "../lib/ai/config";
import { deriveAiMediaSigningKey } from "../lib/ai/media-token";
import { MAX_BOARD_ASSISTANCE_WALL_TIME_MS } from "../lib/ai/skills/board-assistance.v1";

const WorkerEnvironmentSchema = z
  .object({
    WORKER_DATABASE_URL: z
      .string()
      .trim()
      .url()
      .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://")),
    AI_PROVIDER: z.literal(FABRIC_AI_PROVIDER),
    AI_BASE_URL: z.string().trim().min(1),
    AI_API_KEYS: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().trim().min(1),
    AI_STREAM_ONLY: z.literal("true"),
    APP_URL: z.string().trim().url(),
    AUTH_SECRET: z.string().min(32).max(4_096),
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
    provider: parsed.AI_PROVIDER,
    baseUrl: parsed.AI_BASE_URL,
    apiKeys: parseAiApiKeys(parsed),
    model: parsed.AI_MODEL,
    streamOnly: parsed.AI_STREAM_ONLY === "true",
    requestTimeoutMs: MAX_BOARD_ASSISTANCE_WALL_TIME_MS,
  });
  const mediaBaseUrl = new URL(parsed.APP_URL);
  const localMediaOrigin =
    mediaBaseUrl.protocol === "http:" &&
    (mediaBaseUrl.hostname === "localhost" || mediaBaseUrl.hostname === "127.0.0.1");
  if (
    (mediaBaseUrl.protocol !== "https:" && !localMediaOrigin) ||
    mediaBaseUrl.username ||
    mediaBaseUrl.password ||
    mediaBaseUrl.search ||
    mediaBaseUrl.hash ||
    (mediaBaseUrl.pathname !== "/" && mediaBaseUrl.pathname !== "")
  ) {
    throw new Error("APP_URL must be a credential-free application origin.");
  }
  const mediaSigningKey = deriveAiMediaSigningKey(parsed.AUTH_SECRET);

  return Object.freeze({
    databaseUrl: parsed.WORKER_DATABASE_URL,
    ai,
    media: Object.freeze({
      baseUrl: mediaBaseUrl.origin,
      signingKey: mediaSigningKey,
    }),
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
