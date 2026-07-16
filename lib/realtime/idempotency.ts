export type IdempotencyDecision =
  | { kind: "new" }
  | { kind: "replay" }
  | { kind: "conflict" };

export function classifyIdempotency(
  existingHash: string | null | undefined,
  incomingHash: string,
): IdempotencyDecision {
  if (!existingHash) return { kind: "new" };
  return existingHash === incomingHash ? { kind: "replay" } : { kind: "conflict" };
}
