import type * as Y from "yjs";

import type { RealtimeCapability, RealtimeErrorCode } from "../constants";
import type { RealtimeMultiTabConfiguration } from "./multi-tab";

export type RealtimeConnectionState =
  | "idle"
  | "ticketing"
  | "connecting"
  | "authenticating"
  | "syncing"
  | "connected"
  | "reconnecting"
  | "offline"
  | "permission-denied"
  | "stopped"
  | "error";

export type RealtimeClientErrorCode =
  | RealtimeErrorCode
  | "browser_unsupported"
  | "generation_changed"
  | "offline_storage_unavailable"
  | "outbox_conflict"
  | "protocol_error"
  | "reconnect_exhausted"
  | "ticket_failed";

export type RealtimeClientError = {
  code: RealtimeClientErrorCode;
  message: string;
  permanent: boolean;
};

export type RealtimeAwarenessState = {
  cursor?: { x: number; y: number };
  viewport?: { x: number; y: number; width: number; height: number };
  selectionIds?: string[];
  /** Present only on remote state after the realtime server binds identity. */
  principalId?: string;
  /** Present only on remote state after the realtime server binds identity. */
  clientInstanceId?: string;
  /** Present only on remote state and derived from the signed ticket. */
  displayLabel?: string;
  /** Present only on remote state and assigned deterministically by the server. */
  avatarColor?: string;
  /** Added locally only after a remote state passes the server-bound schema. */
  serverAuthoritative?: true;
};

export type RealtimeClientCallbacks = {
  onAwarenessChange?: (
    states: ReadonlyMap<number, RealtimeAwarenessState>,
  ) => void;
  onCapabilitiesChange?: (capabilities: readonly RealtimeCapability[]) => void;
  onConnectionStateChange?: (state: RealtimeConnectionState) => void;
  onError?: (error: RealtimeClientError) => void;
  onLocalUpdateDurable?: (messageId: string) => void;
  onPendingAcknowledgementCountChange?: (count: number) => void;
  onUpdateAcknowledged?: (messageId: string, sequence: number) => void;
};

export type RealtimeScope = {
  principalId: string;
  boardId: string;
  documentGenerationId: string;
};

export type RealtimeClientOptions = RealtimeClientCallbacks & {
  principalId: string;
  boardId: string;
  documentGenerationId?: string;
  document?: Y.Doc;
  realtimeUrl?: string;
  ticketEndpoint?: string;
  fetchImplementation?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocket;
  reconnect?: Partial<ReconnectPolicy>;
  random?: () => number;
  outbox?: PendingUpdateOutbox;
  persistenceFactory?: DocumentPersistenceFactory;
  multiTab?: RealtimeMultiTabConfiguration;
};

export type PendingUpdate = {
  messageId: string;
  payloadHash: string;
  update: Uint8Array;
  createdAt: number;
  attemptCount: number;
  lastAttemptAt?: number;
};

export type PendingUpdateAckResult =
  "acknowledged" | "missing" | "hash_mismatch";

export type RealtimeRecoveryCheckpoint = {
  committedSequence: number;
  stateUpdate: Uint8Array;
  payloadHash: string;
  updatedAt: number;
};

export type RecoveryCheckpointAdvanceResult =
  "advanced" | "duplicate" | "stale" | "conflict";

export interface PendingUpdateOutbox {
  put(scope: RealtimeScope, update: PendingUpdate): Promise<void>;
  list(scope: RealtimeScope): Promise<PendingUpdate[]>;
  replacePending(
    scope: RealtimeScope,
    updates: readonly PendingUpdate[],
    replacements: readonly PendingUpdate[],
    options?: Readonly<{ allowAttempted?: boolean }>,
  ): Promise<boolean>;
  markAttempt(
    scope: RealtimeScope,
    messageId: string,
    attemptedAt: number,
  ): Promise<void>;
  acknowledge(
    scope: RealtimeScope,
    messageId: string,
    payloadHash: string,
  ): Promise<PendingUpdateAckResult>;
  readRecoveryCheckpoint(
    scope: RealtimeScope,
  ): Promise<RealtimeRecoveryCheckpoint | null>;
  advanceRecoveryCheckpoint(
    scope: RealtimeScope,
    checkpoint: RealtimeRecoveryCheckpoint,
  ): Promise<RecoveryCheckpointAdvanceResult>;
  clear(scope: RealtimeScope): Promise<void>;
  close(): Promise<void>;
}

export interface DocumentPersistence {
  readonly origin?: object;
  readonly whenSynced: Promise<void>;
  destroy(): Promise<void>;
  clearData(): Promise<void>;
}

export type DocumentPersistenceFactory = (
  scope: RealtimeScope,
  document: Y.Doc,
) => DocumentPersistence | null;

export type ReconnectPolicy = {
  baseDelayMs: number;
  maximumDelayMs: number;
  jitterRatio: number;
  maximumAttempts: number;
};
