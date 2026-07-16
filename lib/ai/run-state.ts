import type { AiJobStatus, AiRunStatus } from "../../db/schema/ai";

export const TERMINAL_AI_RUN_STATUSES: ReadonlySet<AiRunStatus> = new Set([
  "completed",
  "canceled",
  "policy_denied",
  "provider_unavailable",
  "budget_exceeded",
  "validation_failed",
  "stale_generation",
  "expired_approval",
]);

export const SETTLED_AI_STREAM_STATUSES: ReadonlySet<AiRunStatus> = new Set([
  ...TERMINAL_AI_RUN_STATUSES,
  "waiting_for_approval",
]);

export function isTerminalAiRunStatus(status: AiRunStatus): boolean {
  return TERMINAL_AI_RUN_STATUSES.has(status);
}

export function isSettledAiStreamStatus(status: AiRunStatus): boolean {
  return SETTLED_AI_STREAM_STATUSES.has(status);
}

export function canTransitionAiRun(from: AiRunStatus, to: AiRunStatus): boolean {
  if (from === to) return true;
  if (isTerminalAiRunStatus(from)) return false;
  if (to === "canceled") return true;

  const transitions: Record<AiRunStatus, readonly AiRunStatus[]> = {
    queued: ["preparing_context", "policy_denied", "stale_generation", "budget_exceeded"],
    preparing_context: ["calling_model", "policy_denied", "stale_generation", "budget_exceeded"],
    calling_model: [
      "preparing_context",
      "building_proposal",
      "provider_unavailable",
      "budget_exceeded",
      "validation_failed",
    ],
    building_proposal: [
      "preparing_context",
      "validating_proposal",
      "validation_failed",
      "budget_exceeded",
    ],
    validating_proposal: [
      "preparing_context",
      "waiting_for_approval",
      "validation_failed",
      "stale_generation",
    ],
    waiting_for_approval: ["applying", "expired_approval", "stale_generation"],
    applying: ["completed", "stale_generation", "policy_denied"],
    completed: [],
    canceled: [],
    policy_denied: [],
    provider_unavailable: [],
    budget_exceeded: [],
    validation_failed: [],
    stale_generation: [],
    expired_approval: [],
  };
  return transitions[from].includes(to);
}

export type ClaimableJob = {
  status: AiJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseExpiresAt: Date | null;
};

export function canClaimAiJob(
  job: ClaimableJob,
  run: { status: AiRunStatus; cancelRequestedAt: Date | null; deadlineAt: Date },
  now: Date,
): boolean {
  if (isTerminalAiRunStatus(run.status) || run.status === "waiting_for_approval") return false;
  if (run.cancelRequestedAt || run.deadlineAt <= now || job.attempts >= job.maxAttempts) return false;
  if (job.status === "queued") return job.availableAt <= now;
  return job.status === "leased" && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now;
}

export function retryDelayMs(attempt: number, jitter = 0): number {
  const boundedAttempt = Math.max(1, Math.min(attempt, 6));
  const base = Math.min(30_000, 1_000 * 2 ** (boundedAttempt - 1));
  return Math.round(base * (1 + Math.max(-0.2, Math.min(jitter, 0.2))));
}
