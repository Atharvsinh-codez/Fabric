"use client";

import type { TLStore } from "tldraw";

import {
  captureTldrawCheckpoint,
  type TldrawCheckpoint,
} from "../../boards/tldraw-store-adapter";
import type { RealtimeCapability } from "../constants";
import { FabricRealtimeClient } from "./realtime-client";
import {
  TldrawYjsBridge,
  type TldrawBridgeError,
} from "./tldraw-bridge";
import type {
  DocumentPersistenceFactory,
  PendingUpdateOutbox,
  RealtimeAwarenessState,
  RealtimeClientError,
  RealtimeConnectionState,
  ReconnectPolicy,
} from "./types";

const CHECKPOINT_IDLE_TIMEOUT_MS = 500;

export type TldrawCollaborationError = Readonly<{
  source: "checkpoint" | "realtime" | "tldraw";
  code: string;
  message: string;
  permanent: boolean;
}>;

export type TldrawCollaborationControllerOptions = Readonly<{
  store: TLStore;
  principalId: string;
  boardId: string;
  documentGenerationId: string;
  canEdit: boolean;
  checkpointDebounceMs?: number;
  checkpointSource?: "all" | "local" | "remote";
  onCheckpoint?: (checkpoint: TldrawCheckpoint) => void;
  onAwarenessChange?: (
    states: ReadonlyMap<number, RealtimeAwarenessState>,
  ) => void;
  onCapabilitiesChange?: (capabilities: readonly RealtimeCapability[]) => void;
  onConnectionStateChange?: (state: RealtimeConnectionState) => void;
  onError?: (error: TldrawCollaborationError) => void;
  onLocalUpdateDurable?: (messageId: string) => void;
  onPendingAcknowledgementCountChange?: (count: number) => void;
  onUpdateAcknowledged?: (messageId: string, sequence: number) => void;
  realtime?: Readonly<{
    realtimeUrl?: string;
    ticketEndpoint?: string;
    fetchImplementation?: typeof fetch;
    webSocketFactory?: (url: string) => WebSocket;
    reconnect?: Partial<ReconnectPolicy>;
    random?: () => number;
    outbox?: PendingUpdateOutbox;
    persistenceFactory?: DocumentPersistenceFactory;
  }>;
}>;

export class TldrawCollaborationController {
  readonly realtime: FabricRealtimeClient;

  private readonly options: TldrawCollaborationControllerOptions;
  private bridge: TldrawYjsBridge | null = null;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointIdleCallback: number | null = null;
  private checkpointIdleFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointScheduleVersion = 0;
  private started = false;
  private destroyed = false;

  constructor(options: TldrawCollaborationControllerOptions) {
    this.options = options;
    this.realtime = new FabricRealtimeClient({
      principalId: options.principalId,
      boardId: options.boardId,
      documentGenerationId: options.documentGenerationId,
      ...options.realtime,
      onAwarenessChange: options.onAwarenessChange,
      onCapabilitiesChange: options.onCapabilitiesChange,
      onConnectionStateChange: this.handleConnectionStateChange,
      onError: this.handleRealtimeError,
      onLocalUpdateDurable: options.onLocalUpdateDurable,
      onPendingAcknowledgementCountChange:
        options.onPendingAcknowledgementCountChange,
      onUpdateAcknowledged: options.onUpdateAcknowledged,
    });
  }

  get connectionState(): RealtimeConnectionState {
    return this.realtime.connectionState;
  }

  get capabilities(): readonly RealtimeCapability[] {
    return this.realtime.grantedCapabilities;
  }

  isWriteEnabled(): boolean {
    if (!this.options.canEdit || !this.realtime.isLocalDurabilityAvailable) return false;
    if (
      this.realtime.connectionState === "permission-denied" ||
      this.realtime.connectionState === "error" ||
      this.realtime.connectionState === "stopped"
    ) {
      return false;
    }
    const capabilities = this.realtime.grantedCapabilities;
    // Before a ticket arrives, the Yjs update is still protected by the
    // principal/board/generation IndexedDB journal and pre-ticket buffer.
    // Once a ticket declares capabilities, server authorization wins.
    return capabilities.length === 0 || capabilities.includes("write");
  }

  async start(): Promise<void> {
    if (this.destroyed) throw new Error("This tldraw collaboration controller was destroyed.");
    if (this.started) return;
    this.started = true;
    this.bridge = new TldrawYjsBridge({
      document: this.realtime.document,
      store: this.options.store,
      canWrite: () => this.isWriteEnabled(),
      onError: this.handleBridgeError,
      onLocalStoreChange: () => this.scheduleCheckpoint("local"),
      onRemoteStoreChange: () => this.scheduleCheckpoint("remote"),
    });
    // Attach the read-only guard before IndexedDB opens so no user edit can
    // slip between editor mount and the durable realtime journal.
    await this.realtime.prepareLocalDocument(this.options.documentGenerationId);
    if (this.destroyed) return;
    // Principal + board + generation scoped IndexedDB recovery wins over the
    // older HTTP checkpoint, but is marked remote so it cannot echo to Yjs.
    if (this.bridge.hasRecords()) this.bridge.applyAllRecords();
    this.realtime.connect();
  }

  setAwarenessState(state: RealtimeAwarenessState | null): void {
    this.realtime.setAwarenessState(state);
  }

  captureCheckpoint(): TldrawCheckpoint {
    return captureTldrawCheckpoint(this.options.store);
  }

  async destroy(options: { clearLocalData?: boolean } = {}): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelScheduledCheckpoint();
    this.bridge?.destroy();
    this.bridge = null;
    await this.realtime.destroy(options);
  }

  private readonly handleConnectionStateChange = (
    state: RealtimeConnectionState,
  ): void => {
    if (state === "connected" && this.bridge && !this.bridge.hasRecords()) {
      // The server snapshot has already been applied when `connected` fires.
      // Seed only a genuinely empty room, never overwrite an existing room
      // from a potentially stale HTTP recovery checkpoint.
      if (this.bridge.seedFromStore()) this.scheduleCheckpoint("local");
    }
    try {
      this.options.onConnectionStateChange?.(state);
    } catch {
      // Rendering callbacks are outside the consistency boundary.
    }
  };

  private readonly handleRealtimeError = (error: RealtimeClientError): void => {
    this.emitError({
      source: "realtime",
      code: error.code,
      message: error.message,
      permanent: error.permanent,
    });
  };

  private readonly handleBridgeError = (error: TldrawBridgeError): void => {
    this.emitError({
      source: "tldraw",
      code: error.code,
      message: error.message,
      permanent: error.code === "invalid_record" || error.code === "document_limit",
    });
  };

  private scheduleCheckpoint(source: "local" | "remote"): void {
    if (this.destroyed || !this.options.canEdit || !this.options.onCheckpoint) return;
    const configuredSource = this.options.checkpointSource ?? "all";
    if (configuredSource !== "all" && configuredSource !== source) return;
    this.cancelScheduledCheckpoint();
    const scheduleVersion = this.checkpointScheduleVersion;
    const delay = Math.min(
      5_000,
      Math.max(100, this.options.checkpointDebounceMs ?? 500),
    );
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      if (scheduleVersion !== this.checkpointScheduleVersion || this.destroyed) return;
      this.scheduleCheckpointDuringIdle(scheduleVersion);
    }, delay);
  }

  private scheduleCheckpointDuringIdle(scheduleVersion: number): void {
    let completed = false;
    const checkpoint = () => {
      if (
        completed ||
        scheduleVersion !== this.checkpointScheduleVersion ||
        this.destroyed
      ) {
        return;
      }
      completed = true;
      this.checkpointIdleCallback = null;
      this.checkpointIdleFallbackTimer = null;
      this.checkpointScheduleVersion += 1;
      try {
        this.options.onCheckpoint?.(captureTldrawCheckpoint(this.options.store));
      } catch {
        this.emitError({
          source: "checkpoint",
          code: "checkpoint_failed",
          message: "Fabric could not create the bounded HTTP recovery checkpoint.",
          permanent: false,
        });
      }
    };

    if (
      typeof globalThis.requestIdleCallback === "function" &&
      typeof globalThis.cancelIdleCallback === "function"
    ) {
      try {
        this.checkpointIdleCallback = globalThis.requestIdleCallback(checkpoint, {
          timeout: CHECKPOINT_IDLE_TIMEOUT_MS,
        });
        return;
      } catch {
        this.checkpointIdleCallback = null;
      }
    }

    this.checkpointIdleFallbackTimer = setTimeout(checkpoint, 0);
  }

  private cancelScheduledCheckpoint(): void {
    this.checkpointScheduleVersion += 1;
    if (this.checkpointTimer !== null) clearTimeout(this.checkpointTimer);
    this.checkpointTimer = null;
    if (this.checkpointIdleCallback !== null) {
      globalThis.cancelIdleCallback?.(this.checkpointIdleCallback);
    }
    this.checkpointIdleCallback = null;
    if (this.checkpointIdleFallbackTimer !== null) {
      clearTimeout(this.checkpointIdleFallbackTimer);
    }
    this.checkpointIdleFallbackTimer = null;
  }

  private emitError(error: TldrawCollaborationError): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Error presentation must not interrupt collaboration cleanup.
    }
  }
}
