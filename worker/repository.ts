import type { AiRunStatus } from "../db/schema/ai";
import type { FabricAiModel } from "../lib/ai/config";
import type {
  ClarificationReadyPayload,
  ModelUsage,
  ProposalReadyPayload,
} from "../lib/ai/contracts";
import type { AiProposalRequest } from "../lib/ai/proposal-request";
import {
  canTransitionAiRun,
  isSettledAiStreamStatus,
  isTerminalAiRunStatus,
} from "../lib/ai/run-state";
import type { FabricAiSseEventName, FabricAiSsePayloads } from "../lib/ai/sse";

import type { WorkerSql, WorkerTransaction } from "./database";

type LockedRun = {
  status: AiRunStatus;
  lastEventSequence: number | string;
  cancelRequestedAt: Date | null;
};

export type ClaimedAiJob = {
  jobId: string;
  providerKeyOrdinal: number;
  runId: string;
  leaseOwner: string;
  attempt: number;
  maxAttempts: number;
  runStatus: AiRunStatus;
  skillVersion: string;
  promptVersion: string;
  provider: string;
  model: FabricAiModel;
  principalId: string;
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  baseDurableSequence: number;
  selectionHash: string;
  executionInput: AiProposalRequest;
  deadlineAt: Date;
};

type ClaimedAiJobRow = Omit<
  ClaimedAiJob,
  "providerKeyOrdinal" | "attempt" | "maxAttempts" | "baseDurableSequence"
> & {
  providerKeyOrdinal: number | string | bigint;
  attempt: number | string;
  maxAttempts: number | string;
  baseDurableSequence: number | string;
};

const MAX_SAFE_ORDINAL = BigInt(Number.MAX_SAFE_INTEGER);

function normalizeProviderKeyOrdinal(value: number | string | bigint): number {
  let ordinal: bigint;
  try {
    if (typeof value === "bigint") {
      ordinal = value;
    } else if (typeof value === "number" && Number.isSafeInteger(value)) {
      ordinal = BigInt(value);
    } else if (typeof value === "string" && /^[1-9]\d*$/u.test(value)) {
      ordinal = BigInt(value);
    } else {
      throw new Error("invalid ordinal shape");
    }
  } catch {
    throw new Error("The claimed AI job has an invalid provider key ordinal.");
  }
  if (ordinal < BigInt(1) || ordinal > MAX_SAFE_ORDINAL) {
    throw new Error("The claimed AI job provider key ordinal is outside the safe range.");
  }
  return Number(ordinal);
}

function normalizeClaimedAiJob(claimed: ClaimedAiJobRow): ClaimedAiJob {
  return {
    ...claimed,
    providerKeyOrdinal: normalizeProviderKeyOrdinal(claimed.providerKeyOrdinal),
    attempt: Number(claimed.attempt),
    maxAttempts: Number(claimed.maxAttempts),
    baseDurableSequence: Number(claimed.baseDurableSequence),
  };
}

type PostgresJson = Parameters<WorkerSql["json"]>[0];

function asJson(value: unknown): PostgresJson {
  return JSON.parse(JSON.stringify(value)) as PostgresJson;
}

async function lockRun(transaction: WorkerTransaction, runId: string): Promise<LockedRun | null> {
  const rows = await transaction<LockedRun[]>`
    select
      status,
      last_event_sequence as "lastEventSequence",
      cancel_requested_at as "cancelRequestedAt"
    from ai_runs
    where id = ${runId}
    for update
  `;
  return rows[0] ?? null;
}

async function insertEvent<Name extends FabricAiSseEventName>(
  transaction: WorkerTransaction,
  runId: string,
  sequence: number,
  type: Name,
  payload: FabricAiSsePayloads[Name],
  now: Date,
): Promise<void> {
  await transaction`
    insert into ai_run_events (run_id, sequence, type, payload, created_at)
    values (${runId}, ${sequence}, ${type}, ${transaction.json(asJson(payload))}, ${now})
  `;
}

export async function claimNextAiJob(
  sql: WorkerSql,
  input: { workerId: string; leaseMs: number; now?: Date },
): Promise<ClaimedAiJob | null> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const rows = await sql<ClaimedAiJobRow[]>`
    with candidate as (
      select j.id
      from ai_jobs j
      join ai_runs r on r.id = j.run_id
      where
        (
          (j.status = 'queued' and j.available_at <= ${now})
          or (j.status = 'leased' and j.lease_expires_at <= ${now})
        )
        and j.attempts < j.max_attempts
        and r.cancel_requested_at is null
        and r.deadline_at > ${now}
        and r.status in (
          'queued', 'preparing_context', 'calling_model',
          'building_proposal', 'validating_proposal'
        )
      order by j.available_at asc, j.created_at asc
      for update of j skip locked
      limit 1
    ), claimed as (
      update ai_jobs j
      set
        status = 'leased',
        attempts = j.attempts + 1,
        lease_owner = ${input.workerId},
        lease_expires_at = ${leaseExpiresAt},
        updated_at = ${now}
      from candidate c
      where j.id = c.id
      returning j.*
    )
    select
      c.id as "jobId",
      nextval('ai_provider_key_ordinal_seq') as "providerKeyOrdinal",
      c.run_id as "runId",
      c.lease_owner as "leaseOwner",
      c.attempts as attempt,
      c.max_attempts as "maxAttempts",
      r.status as "runStatus",
      r.skill_version as "skillVersion",
      r.prompt_version as "promptVersion",
      r.provider as provider,
      r.model as model,
      r.principal_id as "principalId",
      r.workspace_id as "workspaceId",
      r.board_id as "boardId",
      r.document_generation_id as "documentGenerationId",
      r.base_durable_sequence as "baseDurableSequence",
      r.selection_hash as "selectionHash",
      r.execution_input as "executionInput",
      r.deadline_at as "deadlineAt"
    from claimed c
    join ai_runs r on r.id = c.run_id
  `;
  const claimed = rows[0];
  if (!claimed) return null;
  return normalizeClaimedAiJob(claimed);
}

/** Claims only the authenticated run that triggered a serverless invocation. */
export async function claimAiJobByRunId(
  sql: WorkerSql,
  input: { runId: string; workerId: string; leaseMs: number; now?: Date },
): Promise<ClaimedAiJob | null> {
  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  const rows = await sql<ClaimedAiJobRow[]>`
    with candidate as (
      select j.id
      from ai_jobs j
      join ai_runs r on r.id = j.run_id
      where
        j.run_id = ${input.runId}
        and (
          (j.status = 'queued' and j.available_at <= ${now})
          or (j.status = 'leased' and j.lease_expires_at <= ${now})
        )
        and j.attempts < j.max_attempts
        and r.cancel_requested_at is null
        and r.deadline_at > ${now}
        and r.status in (
          'queued', 'preparing_context', 'calling_model',
          'building_proposal', 'validating_proposal'
        )
      for update of j skip locked
      limit 1
    ), claimed as (
      update ai_jobs j
      set
        status = 'leased',
        attempts = j.attempts + 1,
        lease_owner = ${input.workerId},
        lease_expires_at = ${leaseExpiresAt},
        updated_at = ${now}
      from candidate c
      where j.id = c.id
      returning j.*
    )
    select
      c.id as "jobId",
      nextval('ai_provider_key_ordinal_seq') as "providerKeyOrdinal",
      c.run_id as "runId",
      c.lease_owner as "leaseOwner",
      c.attempts as attempt,
      c.max_attempts as "maxAttempts",
      r.status as "runStatus",
      r.skill_version as "skillVersion",
      r.prompt_version as "promptVersion",
      r.provider as provider,
      r.model as model,
      r.principal_id as "principalId",
      r.workspace_id as "workspaceId",
      r.board_id as "boardId",
      r.document_generation_id as "documentGenerationId",
      r.base_durable_sequence as "baseDurableSequence",
      r.selection_hash as "selectionHash",
      r.execution_input as "executionInput",
      r.deadline_at as "deadlineAt"
    from claimed c
    join ai_runs r on r.id = c.run_id
  `;
  const claimed = rows[0];
  if (!claimed) return null;
  return normalizeClaimedAiJob(claimed);
}

export async function refreshAiJobLease(
  sql: WorkerSql,
  input: { jobId: string; workerId: string; leaseMs: number; now?: Date },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const rows = await sql<{ id: string }[]>`
    update ai_jobs
    set lease_expires_at = ${new Date(now.getTime() + input.leaseMs)}, updated_at = ${now}
    where id = ${input.jobId} and status = 'leased' and lease_owner = ${input.workerId}
    returning id
  `;
  return rows.length === 1;
}

export async function readAiRunControl(
  sql: WorkerSql,
  runId: string,
): Promise<{ status: AiRunStatus; cancelRequestedAt: Date | null; deadlineAt: Date } | null> {
  const rows = await sql<
    { status: AiRunStatus; cancelRequestedAt: Date | null; deadlineAt: Date }[]
  >`
    select
      status,
      cancel_requested_at as "cancelRequestedAt",
      deadline_at as "deadlineAt"
    from ai_runs
    where id = ${runId}
  `;
  return rows[0] ?? null;
}

export async function baseSnapshotIsCurrent(sql: WorkerSql, job: ClaimedAiJob): Promise<boolean> {
  const rows = await sql<
    { workspaceId: string; generationId: string; durableSequence: number | string }[]
  >`
    select
      b.workspace_id as "workspaceId",
      b.document_generation_id as "generationId",
      b.revision as "durableSequence"
    from boards b
    where b.id = ${job.boardId} and b.archived_at is null
    limit 1
  `;
  const current = rows[0];
  return Boolean(
    current &&
      current.workspaceId === job.workspaceId &&
      current.generationId === job.documentGenerationId &&
      Number(current.durableSequence) === job.baseDurableSequence,
  );
}

export async function recordRunProgress(
  sql: WorkerSql,
  input: {
    runId: string;
    status: AiRunStatus;
    phase: FabricAiSsePayloads["run.progress"]["phase"];
    message: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return sql.begin(async (transaction) => {
    const run = await lockRun(transaction, input.runId);
    if (!run || run.cancelRequestedAt || isTerminalAiRunStatus(run.status)) return false;
    if (!canTransitionAiRun(run.status, input.status)) return false;
    const sequence = Number(run.lastEventSequence) + 1;
    await transaction`
      update ai_runs
      set
        status = ${input.status},
        started_at = coalesce(started_at, ${now}),
        last_event_sequence = ${sequence},
        updated_at = ${now}
      where id = ${input.runId}
    `;
    await insertEvent(
      transaction,
      input.runId,
      sequence,
      "run.progress",
      { phase: input.phase, message: input.message },
      now,
    );
    return true;
  });
}

export async function recordProviderInteractionId(
  sql: WorkerSql,
  runId: string,
  interactionId: string,
): Promise<void> {
  await sql`
    update ai_runs
    set provider_interaction_id = ${interactionId}, updated_at = now()
    where id = ${runId} and provider_interaction_id is null
  `;
}

export async function recordProposalDelta(
  sql: WorkerSql,
  runId: string,
  text: string,
  now = new Date(),
): Promise<boolean> {
  const rows = await sql<{ inserted: boolean }[]>`
    with updated as (
      update ai_runs
      set
        last_event_sequence = last_event_sequence + 1,
        updated_at = ${now}
      where
        id = ${runId}
        and cancel_requested_at is null
        and status in (
          'queued', 'preparing_context', 'calling_model',
          'building_proposal', 'validating_proposal'
        )
      returning last_event_sequence
    ), inserted as (
      insert into ai_run_events (run_id, sequence, type, payload, created_at)
      select
        ${runId},
        updated.last_event_sequence,
        'proposal.delta',
        ${sql.json(asJson({ text }))},
        ${now}
      from updated
      returning 1
    )
    select exists(select 1 from inserted) as inserted
  `;
  return rows[0]?.inserted === true;
}

export async function recordProposalReady(
  sql: WorkerSql,
  input: {
    job: ClaimedAiJob;
    proposal: ProposalReadyPayload;
    responseHash: string;
    usage: ModelUsage;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return sql.begin(async (transaction) => {
    const run = await lockRun(transaction, input.job.runId);
    if (!run || run.cancelRequestedAt || isSettledAiStreamStatus(run.status)) return false;
    if (!canTransitionAiRun(run.status, "waiting_for_approval")) return false;
    const sequence = Number(run.lastEventSequence) + 1;
    await transaction`
      update ai_runs
      set
        status = 'waiting_for_approval',
        response_hash = ${input.responseHash},
        proposal = ${transaction.json(asJson(input.proposal.patch))},
        proposal_hash = ${input.proposal.patchHash},
        proposal_risk_class = ${input.proposal.riskClass},
        usage = ${transaction.json(asJson(input.usage))},
        execution_input = ${transaction.json({ redacted: true })},
        last_event_sequence = ${sequence},
        updated_at = ${now}
      where id = ${input.job.runId}
    `;
    await transaction`
      update ai_jobs
      set
        status = 'succeeded',
        lease_owner = null,
        lease_expires_at = null,
        updated_at = ${now}
      where id = ${input.job.jobId} and lease_owner = ${input.job.leaseOwner}
    `;
    await insertEvent(
      transaction,
      input.job.runId,
      sequence,
      "proposal.ready",
      input.proposal,
      now,
    );
    return true;
  });
}

export async function recordClarificationReady(
  sql: WorkerSql,
  input: {
    job: ClaimedAiJob;
    clarification: ClarificationReadyPayload;
    responseHash: string;
    usage: ModelUsage;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return sql.begin(async (transaction) => {
    const run = await lockRun(transaction, input.job.runId);
    if (!run || run.cancelRequestedAt || isSettledAiStreamStatus(run.status)) return false;
    if (!canTransitionAiRun(run.status, "completed")) return false;
    const clarificationSequence = Number(run.lastEventSequence) + 1;
    const completedSequence = clarificationSequence + 1;
    await transaction`
      update ai_runs
      set
        status = 'completed',
        response_hash = ${input.responseHash},
        usage = ${transaction.json(asJson(input.usage))},
        execution_input = ${transaction.json({ redacted: true })},
        finished_at = ${now},
        last_event_sequence = ${completedSequence},
        updated_at = ${now}
      where id = ${input.job.runId}
    `;
    await transaction`
      update ai_jobs
      set
        status = 'succeeded',
        lease_owner = null,
        lease_expires_at = null,
        updated_at = ${now}
      where id = ${input.job.jobId} and lease_owner = ${input.job.leaseOwner}
    `;
    await insertEvent(
      transaction,
      input.job.runId,
      clarificationSequence,
      "clarification.ready",
      input.clarification,
      now,
    );
    await insertEvent(
      transaction,
      input.job.runId,
      completedSequence,
      "run.completed",
      { usage: input.usage },
      now,
    );
    return true;
  });
}

export async function recordRunCanceled(
  sql: WorkerSql,
  input: {
    runId: string;
    reason: FabricAiSsePayloads["run.canceled"]["reason"];
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return sql.begin(async (transaction) => {
    const run = await lockRun(transaction, input.runId);
    if (!run || isSettledAiStreamStatus(run.status)) return false;
    const sequence = Number(run.lastEventSequence) + 1;
    await transaction`
      update ai_runs
      set
        status = 'canceled',
        cancel_requested_at = coalesce(cancel_requested_at, ${now}),
        execution_input = ${transaction.json({ redacted: true })},
        finished_at = ${now},
        last_event_sequence = ${sequence},
        updated_at = ${now}
      where id = ${input.runId}
    `;
    await transaction`
      update ai_jobs
      set status = 'canceled', lease_owner = null, lease_expires_at = null, updated_at = ${now}
      where run_id = ${input.runId}
    `;
    await insertEvent(
      transaction,
      input.runId,
      sequence,
      "run.canceled",
      { reason: input.reason },
      now,
    );
    return true;
  });
}

export async function recordRunFailure(
  sql: WorkerSql,
  input: {
    job: ClaimedAiJob;
    status: Extract<
      AiRunStatus,
      "provider_unavailable" | "budget_exceeded" | "validation_failed" | "stale_generation"
    >;
    error: FabricAiSsePayloads["run.error"];
    responseHash?: string;
    usage?: ModelUsage;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return sql.begin(async (transaction) => {
    const run = await lockRun(transaction, input.job.runId);
    if (!run || isSettledAiStreamStatus(run.status)) return false;
    if (run.cancelRequestedAt) return false;
    const sequence = Number(run.lastEventSequence) + 1;
    await transaction`
      update ai_runs
      set
        status = ${input.status},
        safe_error = ${transaction.json(asJson(input.error))},
        response_hash = coalesce(${input.responseHash ?? null}, response_hash),
        usage = coalesce(${input.usage ? transaction.json(asJson(input.usage)) : null}, usage),
        execution_input = ${transaction.json({ redacted: true })},
        finished_at = ${now},
        last_event_sequence = ${sequence},
        updated_at = ${now}
      where id = ${input.job.runId}
    `;
    await transaction`
      update ai_jobs
      set
        status = 'dead',
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ${input.error.code},
        updated_at = ${now}
      where id = ${input.job.jobId}
    `;
    await insertEvent(transaction, input.job.runId, sequence, "run.error", input.error, now);
    return true;
  });
}

export async function releaseAiJobForRetry(
  sql: WorkerSql,
  input: {
    job: ClaimedAiJob;
    availableAt: Date;
    errorCode: string;
    message: string;
    now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  return sql.begin(async (transaction) => {
    const run = await lockRun(transaction, input.job.runId);
    if (!run || run.cancelRequestedAt || isSettledAiStreamStatus(run.status)) return false;
    const sequence = Number(run.lastEventSequence) + 1;
    const updated = await transaction<{ id: string }[]>`
      update ai_jobs
      set
        status = 'queued',
        available_at = ${input.availableAt},
        lease_owner = null,
        lease_expires_at = null,
        last_error_code = ${input.errorCode},
        updated_at = ${now}
      where
        id = ${input.job.jobId}
        and status = 'leased'
        and lease_owner = ${input.job.leaseOwner}
        and attempts < max_attempts
      returning id
    `;
    if (updated.length === 0) return false;
    await transaction`
      update ai_runs
      set last_event_sequence = ${sequence}, updated_at = ${now}
      where id = ${input.job.runId}
    `;
    await insertEvent(
      transaction,
      input.job.runId,
      sequence,
      "run.progress",
      { phase: "calling_model", message: input.message },
      now,
    );
    return true;
  });
}

export async function listExpiredActiveRunIds(
  sql: WorkerSql,
  now = new Date(),
): Promise<string[]> {
  const rows = await sql<{ id: string }[]>`
    select id
    from ai_runs
    where
      deadline_at <= ${now}
      and status in (
        'queued', 'preparing_context', 'calling_model',
        'building_proposal', 'validating_proposal'
      )
    order by deadline_at asc
    limit 25
  `;
  return rows.map((row) => row.id);
}

export async function cleanupAiRetention(
  sql: WorkerSql,
  input: { eventCutoff: Date; runCutoff: Date },
): Promise<{ eventsDeleted: number; runsDeleted: number }> {
  const events = await sql<{ runId: string }[]>`
    delete from ai_run_events e
    using ai_runs r
    where
      e.run_id = r.id
      and e.created_at < ${input.eventCutoff}
      and r.status in (
        'completed', 'canceled', 'policy_denied', 'provider_unavailable',
        'budget_exceeded', 'validation_failed', 'stale_generation', 'expired_approval'
      )
    returning e.run_id as "runId"
  `;
  const runs = await sql<{ id: string }[]>`
    delete from ai_runs
    where
      created_at < ${input.runCutoff}
      and status in (
        'completed', 'canceled', 'policy_denied', 'provider_unavailable',
        'budget_exceeded', 'validation_failed', 'stale_generation', 'expired_approval'
      )
    returning id
  `;
  return { eventsDeleted: events.length, runsDeleted: runs.length };
}
