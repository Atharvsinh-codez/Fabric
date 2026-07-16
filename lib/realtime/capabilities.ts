import type { RealtimeCapability } from "./constants";

export type RealtimeWorkspaceRole = "commenter" | "editor" | "owner" | "viewer";

export function capabilitiesForRole(role: RealtimeWorkspaceRole): RealtimeCapability[] {
  return role === "owner" || role === "editor"
    ? ["read", "write", "awareness"]
    : ["read", "awareness"];
}

export function capabilitiesAreAllowed(
  requested: readonly RealtimeCapability[],
  allowed: readonly RealtimeCapability[],
): boolean {
  const allowedSet = new Set(allowed);
  return requested.every((capability) => allowedSet.has(capability));
}
