import type { ReconnectPolicy } from "./types";

export const DEFAULT_RECONNECT_POLICY: ReconnectPolicy = {
  baseDelayMs: 500,
  maximumDelayMs: 15_000,
  jitterRatio: 0.2,
  maximumAttempts: 8,
};

export function normalizeReconnectPolicy(
  partial: Partial<ReconnectPolicy> | undefined,
): ReconnectPolicy {
  const policy = { ...DEFAULT_RECONNECT_POLICY, ...partial };
  if (
    !Number.isFinite(policy.baseDelayMs) ||
    !Number.isFinite(policy.maximumDelayMs) ||
    !Number.isFinite(policy.jitterRatio) ||
    !Number.isInteger(policy.maximumAttempts) ||
    policy.baseDelayMs < 100 ||
    policy.maximumDelayMs < policy.baseDelayMs ||
    policy.maximumDelayMs > 60_000 ||
    policy.jitterRatio < 0 ||
    policy.jitterRatio > 0.5 ||
    policy.maximumAttempts < 1 ||
    policy.maximumAttempts > 20
  ) {
    throw new RangeError("The realtime reconnect policy is outside its safe bounds.");
  }
  return policy;
}

export function reconnectDelayMs(
  attempt: number,
  policy: ReconnectPolicy,
  random: () => number = Math.random,
): number {
  const boundedAttempt = Math.max(0, Math.min(attempt, policy.maximumAttempts));
  const withoutJitter = Math.min(
    policy.maximumDelayMs,
    policy.baseDelayMs * 2 ** boundedAttempt,
  );
  const randomValue = Math.max(0, Math.min(1, random()));
  const jitterMultiplier = 1 + (randomValue * 2 - 1) * policy.jitterRatio;
  return Math.max(0, Math.round(withoutJitter * jitterMultiplier));
}

export function shouldStopAfterClose(code: number): boolean {
  return code === 4400 || code === 4403 || code === 4409 || code === 4413;
}

export function shouldRefreshLeaseAfterClose(
  code: number,
  reason: string,
): boolean {
  return (
    code === 1012 &&
    (reason === "connection_lease_expired" || reason === "access_scope_changed")
  );
}
