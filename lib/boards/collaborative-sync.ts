import type { BoardSyncState } from "./use-board-document";
import type { RealtimeConnectionState } from "../realtime/client/types";

export type AgentBoardReadinessState = "ready" | "syncing" | "needs-retry";

export type AgentBoardReadiness = Readonly<{
  state: AgentBoardReadinessState;
  shouldRetryPersistence: boolean;
}>;

export function resolveAgentBoardReadiness(
  persistenceState: BoardSyncState,
  connectionState: RealtimeConnectionState,
  pendingAcknowledgements: number,
): AgentBoardReadiness {
  const realtimeReady =
    connectionState === "connected" && pendingAcknowledgements === 0;
  if (persistenceState === "synced" && realtimeReady) {
    return { state: "ready", shouldRetryPersistence: false };
  }

  const persistenceNeedsRetry =
    persistenceState === "offline" ||
    persistenceState === "conflict" ||
    persistenceState === "error";
  const realtimeNeedsRetry =
    connectionState === "offline" ||
    connectionState === "permission-denied" ||
    connectionState === "error" ||
    connectionState === "stopped";

  return {
    state:
      persistenceNeedsRetry || realtimeNeedsRetry ? "needs-retry" : "syncing",
    // A healthy realtime session is evidence that a previously failed HTTP
    // checkpoint is worth one immediate retry. It is not a substitute for the
    // authoritative checkpoint that the AI route validates.
    shouldRetryPersistence: realtimeReady && persistenceNeedsRetry,
  };
}

export function collaborativeSyncState(
  baseState: BoardSyncState,
  connectionState: RealtimeConnectionState,
  pendingAcknowledgements: number,
): BoardSyncState {
  if (baseState === "conflict" || baseState === "error" || baseState === "offline") {
    return baseState;
  }
  if (
    connectionState === "permission-denied" ||
    connectionState === "error" ||
    connectionState === "stopped"
  ) {
    return "error";
  }
  if (connectionState === "offline" || connectionState === "reconnecting") {
    return "offline";
  }
  if (
    baseState === "saving" ||
    pendingAcknowledgements > 0 ||
    connectionState !== "connected"
  ) {
    return "saving";
  }
  return "synced";
}

export function collaborativeSyncMessage({
  baseMessage,
  hydrationWarning,
  connectionState,
  realtimeError,
}: {
  baseMessage: string | null;
  hydrationWarning: string | null;
  connectionState: RealtimeConnectionState;
  realtimeError: string | null;
}): string | null {
  let collaborationMessage: string | null = null;
  if (realtimeError) {
    collaborationMessage = realtimeError;
  } else if (connectionState === "offline" || connectionState === "reconnecting") {
    collaborationMessage =
      "Live collaboration is offline. Fabric will retry while keeping this board recoverable on this device.";
  } else if (
    connectionState === "idle" ||
    connectionState === "ticketing" ||
    connectionState === "connecting" ||
    connectionState === "authenticating" ||
    connectionState === "syncing"
  ) {
    collaborationMessage = "Connecting secure live collaboration.";
  }

  const messages = [baseMessage, hydrationWarning, collaborationMessage]
    .filter((message): message is string => Boolean(message))
    .filter((message, index, all) => all.indexOf(message) === index);
  return messages.length > 0 ? messages.join(" ") : null;
}
