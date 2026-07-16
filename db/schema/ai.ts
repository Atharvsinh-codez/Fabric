import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  pgSequence,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { boards, workspaces } from "./product";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const AI_RUN_STATUSES = [
  "queued",
  "preparing_context",
  "calling_model",
  "building_proposal",
  "validating_proposal",
  "waiting_for_approval",
  "applying",
  "completed",
  "canceled",
  "policy_denied",
  "provider_unavailable",
  "budget_exceeded",
  "validation_failed",
  "stale_generation",
  "expired_approval",
] as const;

export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_JOB_STATUSES = ["queued", "leased", "succeeded", "dead", "canceled"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const aiProviderKeyOrdinalSequence = pgSequence(
  "ai_provider_key_ordinal_seq",
  {
    startWith: 1,
    increment: 1,
    minValue: 1,
    maxValue: "9007199254740991",
    cache: 1,
  },
);

export type AiRunExecutionInput = {
  skill: "cluster-by-theme";
  mode?: "feedback" | "suggest" | "solve";
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  durableSequence: number;
  instruction: string;
  selection: Array<Record<string, unknown>>;
} | { redacted: true };

export type AiRunUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thoughtTokens?: number;
  toolTokens?: number;
  totalTokens?: number;
};

export type AiRunSafeError = {
  code: string;
  message: string;
  retryable: boolean;
  issueCodes?: string[];
};

export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    documentGenerationId: uuid("document_generation_id").notNull(),
    baseDurableSequence: bigint("base_durable_sequence", { mode: "number" }).notNull(),
    selectionHash: text("selection_hash").notNull(),
    idempotencyHash: text("idempotency_hash").notNull(),
    inputHash: text("input_hash").notNull(),
    executionInput: jsonb("execution_input").$type<AiRunExecutionInput>().notNull(),
    status: text("status").$type<AiRunStatus>().default("queued").notNull(),
    skillId: text("skill_id").notNull(),
    skillVersion: text("skill_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    provider: text("provider").default("google-gemini").notNull(),
    // Keep the legacy database default during mixed-version rollout. New code
    // always persists its reviewed model explicitly, so old 3.5 workers cannot
    // accidentally record 2.5 provenance before they are drained.
    model: text("model").default("gemini-3.5-flash").notNull(),
    sdkVersion: text("sdk_version").notNull(),
    configVersion: text("config_version").notNull(),
    lastEventSequence: bigint("last_event_sequence", { mode: "number" }).default(0).notNull(),
    providerInteractionId: text("provider_interaction_id"),
    responseHash: text("response_hash"),
    proposal: jsonb("proposal").$type<Record<string, unknown>>(),
    proposalHash: text("proposal_hash"),
    proposalRiskClass: text("proposal_risk_class"),
    usage: jsonb("usage").$type<AiRunUsage>().default({}).notNull(),
    safeError: jsonb("safe_error").$type<AiRunSafeError>(),
    cancelRequestedAt: timestampWithTimezone("cancel_requested_at"),
    deadlineAt: timestampWithTimezone("deadline_at").notNull(),
    startedAt: timestampWithTimezone("started_at"),
    finishedAt: timestampWithTimezone("finished_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_runs_principal_idempotency_unique").on(
      table.principalId,
      table.idempotencyHash,
    ),
    index("ai_runs_principal_created_idx").on(table.principalId, table.createdAt),
    index("ai_runs_board_created_idx").on(table.boardId, table.createdAt),
    index("ai_runs_status_updated_idx").on(table.status, table.updatedAt),
    check("ai_runs_base_sequence_check", sql`${table.baseDurableSequence} >= 0`),
    check("ai_runs_last_event_sequence_check", sql`${table.lastEventSequence} >= 0`),
    check("ai_runs_selection_hash_check", sql`char_length(${table.selectionHash}) = 64`),
    check("ai_runs_idempotency_hash_check", sql`char_length(${table.idempotencyHash}) = 64`),
    check("ai_runs_input_hash_check", sql`char_length(${table.inputHash}) = 64`),
    check(
      "ai_runs_status_check",
      sql`${table.status} in ('queued', 'preparing_context', 'calling_model', 'building_proposal', 'validating_proposal', 'waiting_for_approval', 'applying', 'completed', 'canceled', 'policy_denied', 'provider_unavailable', 'budget_exceeded', 'validation_failed', 'stale_generation', 'expired_approval')`,
    ),
    check("ai_runs_provider_check", sql`${table.provider} = 'google-gemini'`),
    // Preserve historical run provenance while pinning all new runs to the
    // reviewed production model at the application boundary.
    check(
      "ai_runs_model_check",
      sql`${table.model} in ('gemini-3.5-flash', 'gemini-2.5-flash')`,
    ),
    check(
      "ai_runs_hashes_check",
      sql`(${table.responseHash} is null or char_length(${table.responseHash}) = 64) and (${table.proposalHash} is null or char_length(${table.proposalHash}) = 64)`,
    ),
    check("ai_runs_deadline_check", sql`${table.deadlineAt} > ${table.createdAt}`),
  ],
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    status: text("status").$type<AiJobStatus>().default("queued").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    availableAt: timestampWithTimezone("available_at").defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestampWithTimezone("lease_expires_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("ai_jobs_run_unique").on(table.runId),
    index("ai_jobs_claim_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
    check("ai_jobs_attempts_check", sql`${table.attempts} >= 0`),
    check("ai_jobs_max_attempts_check", sql`${table.maxAttempts} between 1 and 10`),
    check("ai_jobs_attempt_bound_check", sql`${table.attempts} <= ${table.maxAttempts}`),
    check(
      "ai_jobs_status_check",
      sql`${table.status} in ('queued', 'leased', 'succeeded', 'dead', 'canceled')`,
    ),
    check(
      "ai_jobs_lease_shape_check",
      sql`(${table.status} = 'leased' and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'leased')`,
    ),
  ],
);

export const aiRunEvents = pgTable(
  "ai_run_events",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => aiRuns.id, { onDelete: "cascade" }),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ name: "ai_run_events_run_sequence_pk", columns: [table.runId, table.sequence] }),
    index("ai_run_events_created_idx").on(table.createdAt),
    check("ai_run_events_sequence_check", sql`${table.sequence} > 0`),
    check("ai_run_events_type_length_check", sql`char_length(${table.type}) between 1 and 64`),
  ],
);
