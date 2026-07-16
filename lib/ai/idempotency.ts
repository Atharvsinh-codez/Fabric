import { createHash } from "node:crypto";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export function parseIdempotencyKey(value: string | null): string | null {
  if (value === null) return null;
  const key = value.trim();
  return IDEMPOTENCY_KEY_PATTERN.test(key) ? key : null;
}
export function hashIdempotencyKey(principalId: string, key: string): string {
  return createHash("sha256")
    .update("fabric-ai-run-idempotency-v1\0", "utf8")
    .update(principalId, "utf8")
    .update("\0", "utf8")
    .update(key, "utf8")
    .digest("hex");
}

export type ExistingIdempotentRun = { id: string; inputHash: string } | null;

export function resolveIdempotentRun(
  existing: ExistingIdempotentRun,
  inputHash: string,
): { action: "create" } | { action: "reuse"; runId: string } | { action: "conflict" } {
  if (!existing) return { action: "create" };
  if (existing.inputHash === inputHash) return { action: "reuse", runId: existing.id };
  return { action: "conflict" };
}
