import * as Y from "yjs";

import {
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
  type RealtimeCapability,
  type RealtimeErrorCode,
} from "../constants";
import { EphemeralAwareness } from "./awareness";
import {
  normalizeReconnectPolicy,
  reconnectDelayMs,
  shouldRefreshLeaseAfterClose,
  shouldStopAfterClose,
} from "./backoff";
import { base64ToBytes, bytesToBase64, hashBytes } from "./encoding";
import {
  IndexedDbPendingUpdateOutbox,
  PendingUpdateConflictError,
  createIndexedDbDocumentPersistence,
} from "./persistence";
import { RealtimeTabCoordinator, type RealtimeTabMessage } from "./multi-tab";
import {
  parseServerEnvelope,
  serializeAuthFrame,
  serializeAuthRefreshFrame,
  type ValidatedServerEnvelope,
} from "./protocol";
import { detectRealtimeBrowserSupport, requireUuid } from "./support";
import {
  RealtimeTicketRequestError,
  requestRealtimeTicket,
  resolveRealtimeUrl,
  type RealtimeTicket,
} from "./ticket";
import type {
  DocumentPersistence,
  PendingUpdate,
  PendingUpdateOutbox,
  RealtimeAwarenessState,
  RealtimeClientError,
  RealtimeClientOptions,
  RealtimeConnectionState,
  RealtimeScope,
} from "./types";

const REMOTE_DOCUMENT_ORIGIN = Object.freeze({
  source: "fabric-realtime-remote-document",
});
const MULTI_TAB_DOCUMENT_ORIGIN = Object.freeze({
  source: "fabric-realtime-multi-tab-document",
});
const STABLE_CONNECTION_MS = 30_000;
const ACK_PROGRESS_TIMEOUT_MS = 30_000;
const CLIENT_RECONNECT_CLOSE_CODE = 4000;
const MAX_COMPACTION_UPDATES = 64;
const MAX_IN_FLIGHT_UPDATES = 8;
const OUTBOX_BATCH_DELAY_MS = 75;
const TICKET_REFRESH_MIN_LEAD_MS = 10_000;
const TICKET_REFRESH_MAX_LEAD_MS = 15_000;
const TICKET_REFRESH_RETRY_MS = 5_000;
const MAX_REMEMBERED_ACKNOWLEDGEMENTS = 1_024;

function isSocketOpen(socket: WebSocket | undefined): socket is WebSocket {
  return Boolean(socket && socket.readyState === 1);
}

function invokeSafely(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    callback();
  } catch {
    // Consumer callbacks must never break protocol processing.
  }
}

export class FabricRealtimeClient {
  readonly document: Y.Doc;
  readonly clientInstanceId: string;
  readonly awareness: EphemeralAwareness;

  private readonly ownsDocument: boolean;
  private readonly options: RealtimeClientOptions;
  private readonly reconnectPolicy;
  private readonly random: () => number;
  private readonly ignoredDocumentOrigins = new Set<unknown>([
    REMOTE_DOCUMENT_ORIGIN,
    MULTI_TAB_DOCUMENT_ORIGIN,
  ]);
  private readonly webSocketFactory: (url: string) => WebSocket;
  private outbox: PendingUpdateOutbox | undefined;
  private documentPersistence: DocumentPersistence | null | undefined;
  private scope: RealtimeScope | undefined;
  private socket: WebSocket | undefined;
  private ticket: RealtimeTicket | undefined;
  private ticketAbortController: AbortController | undefined;
  private ticketRefreshAbortController: AbortController | undefined;
  private ticketRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private ticketRefreshMessageId: string | undefined;
  private pendingRefreshTicket: RealtimeTicket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stabilityTimer: ReturnType<typeof setTimeout> | undefined;
  private acknowledgementTimer: ReturnType<typeof setTimeout> | undefined;
  private outboxPumpTimer: ReturnType<typeof setTimeout> | undefined;
  private outboxPump: Promise<void> | undefined;
  private outboxPumpRequested = false;
  private connectionEpoch = 0;
  private reconnectAttempt = 0;
  private state: RealtimeConnectionState = "idle";
  private authenticated = false;
  private destroyed = false;
  private suppressReconnect = false;
  private authMessageId: string | undefined;
  private capabilities: RealtimeCapability[] = [];
  private lastSequence = 0;
  private maximumUpdateBytes = REALTIME_LIMITS.maximumUpdateBytes;
  private readonly inFlight = new Set<string>();
  private localUpdateQueue: Promise<void> = Promise.resolve();
  private messageQueue: Promise<void> = Promise.resolve();
  private storageAvailable = false;
  private reportedStorageUnavailable = false;
  private reportedWriteBlocked = false;
  private authenticationRecoveryInProgress = false;
  private recoveryCompactionPending = false;
  private readonly preScopeUpdates: Uint8Array[] = [];
  private preScopeUpdateBytes = 0;
  private persistenceInitialization: Promise<void> | undefined;
  private pendingAcknowledgementCount = 0;
  private tabCoordinator: RealtimeTabCoordinator | null | undefined;
  private connectionOwner = true;
  private multiTabMessageQueue: Promise<void> = Promise.resolve();
  private committedDocument: Y.Doc | undefined;
  private committedSequence = 0;
  private recoveryCheckpointQueue: Promise<boolean> = Promise.resolve(true);
  private readonly acknowledgedMessageHashes = new Map<string, string>();
  private readonly relayedCommittedMessageHashes = new Map<string, string>();

  constructor(options: RealtimeClientOptions) {
    requireUuid(options.principalId, "principalId");
    requireUuid(options.boardId, "boardId");
    if (options.documentGenerationId) {
      requireUuid(options.documentGenerationId, "documentGenerationId");
    }
    if (!globalThis.crypto?.randomUUID || !globalThis.crypto.subtle) {
      throw new Error(
        "Fabric realtime requires Web Crypto and secure random UUIDs.",
      );
    }
    this.options = options;
    this.document = options.document ?? new Y.Doc({ gc: true });
    this.ownsDocument = !options.document;
    this.clientInstanceId = globalThis.crypto.randomUUID();
    this.reconnectPolicy = normalizeReconnectPolicy(options.reconnect);
    this.random = options.random ?? Math.random;
    this.webSocketFactory =
      options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.outbox = options.outbox;
    this.awareness = new EphemeralAwareness(
      this.document,
      (update) => this.sendAwareness(update),
      options.onAwarenessChange,
    );
    this.document.on("update", this.handleDocumentUpdate);
  }

  get connectionState(): RealtimeConnectionState {
    return this.state;
  }

  get grantedCapabilities(): readonly RealtimeCapability[] {
    return this.capabilities;
  }

  get isLocalDurabilityAvailable(): boolean {
    return this.storageAvailable;
  }

  canWrite(): boolean {
    return this.storageAvailable && this.capabilities.includes("write");
  }

  setAwarenessState(state: RealtimeAwarenessState | null): void {
    this.awareness.setLocalState(state);
  }

  async prepareLocalDocument(documentGenerationId: string): Promise<Y.Doc> {
    requireUuid(documentGenerationId, "documentGenerationId");
    if (this.destroyed)
      throw new Error("This realtime client has been destroyed.");
    await this.initializeLocalPersistence(documentGenerationId);
    return this.document;
  }

  connect(): void {
    if (this.destroyed)
      throw new Error("This realtime client has been destroyed.");
    if (
      this.state === "ticketing" ||
      this.state === "connecting" ||
      this.state === "authenticating" ||
      this.state === "syncing" ||
      this.state === "connected" ||
      this.state === "reconnecting"
    ) {
      return;
    }
    this.suppressReconnect = false;
    this.reconnectAttempt = 0;
    globalThis.addEventListener?.("online", this.handleOnline);
    globalThis.addEventListener?.("offline", this.handleOffline);
    void this.startConnectionOwnership();
  }

  async destroy(options: { clearLocalData?: boolean } = {}): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this.suppressReconnect = true;
    this.connectionEpoch += 1;
    this.clearTimers();
    this.ticketAbortController?.abort();
    this.ticketAbortController = undefined;
    this.ticketRefreshAbortController?.abort();
    this.ticketRefreshAbortController = undefined;
    this.awareness.destroy(this.authenticated && isSocketOpen(this.socket));
    this.authenticated = false;
    if (this.socket && this.socket.readyState < 2)
      this.socket.close(1000, "client_shutdown");
    this.socket = undefined;
    this.document.off("update", this.handleDocumentUpdate);
    globalThis.removeEventListener?.("online", this.handleOnline);
    globalThis.removeEventListener?.("offline", this.handleOffline);
    await this.tabCoordinator?.destroy().catch(() => undefined);
    await Promise.allSettled([
      this.localUpdateQueue,
      this.messageQueue,
      this.multiTabMessageQueue,
      this.outboxPump,
      this.recoveryCheckpointQueue,
    ]);

    if (options.clearLocalData && this.scope) {
      await Promise.allSettled([
        this.documentPersistence?.clearData(),
        this.outbox?.clear(this.scope),
      ]);
      this.setPendingAcknowledgementCount(0);
    } else {
      await this.documentPersistence?.destroy().catch(() => undefined);
    }
    await this.outbox?.close().catch(() => undefined);
    this.committedDocument?.destroy();
    this.committedDocument = undefined;
    if (this.ownsDocument) this.document.destroy();
    this.setState("stopped");
  }

  private async openConnection(): Promise<void> {
    if (
      this.destroyed ||
      this.suppressReconnect ||
      (this.tabCoordinator && !this.connectionOwner)
    ) {
      return;
    }
    const epoch = ++this.connectionEpoch;
    if (this.options.documentGenerationId && !this.scope) {
      await this.initializeLocalPersistence(this.options.documentGenerationId);
      if (epoch !== this.connectionEpoch || this.destroyed) return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setState("offline");
      return;
    }
    const support = detectRealtimeBrowserSupport();
    if (
      (!support.fetch && !this.options.fetchImplementation) ||
      (!support.webSocket && !this.options.webSocketFactory) ||
      !support.secureRandom ||
      !support.webCrypto
    ) {
      this.failPermanently(
        "browser_unsupported",
        "This browser cannot run secure realtime sync.",
      );
      return;
    }

    this.setState("ticketing");
    this.ticketAbortController?.abort();
    const controller = new AbortController();
    this.ticketAbortController = controller;

    try {
      const ticket = await requestRealtimeTicket({
        boardId: this.options.boardId,
        endpoint: this.options.ticketEndpoint,
        fetchImplementation: this.options.fetchImplementation,
        signal: controller.signal,
      });
      if (epoch !== this.connectionEpoch || this.destroyed) return;
      if (ticket.boardId !== this.options.boardId) {
        this.failPermanently(
          "protocol_error",
          "The ticket does not match this board.",
        );
        return;
      }
      if (
        this.scope &&
        this.scope.documentGenerationId !== ticket.documentGenerationId
      ) {
        this.failPermanently(
          "generation_changed",
          "This board was replaced. Reload it before making more changes.",
        );
        return;
      }
      this.ticket = ticket;
      this.capabilities = [...ticket.capabilities];
      this.broadcastOwnerState();
      await this.initializeLocalPersistence(ticket.documentGenerationId);
      this.flushBufferedLocalUpdates();
      await this.localUpdateQueue;
      if (epoch !== this.connectionEpoch || this.destroyed) return;
      this.openSocket(epoch, ticket);
    } catch (error) {
      if (
        controller.signal.aborted ||
        epoch !== this.connectionEpoch ||
        this.destroyed
      )
        return;
      if (
        error instanceof RealtimeTicketRequestError &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        this.failPermanently(
          "permission_denied",
          "Realtime access to this board is no longer available.",
        );
        return;
      }
      const minimumDelay =
        error instanceof RealtimeTicketRequestError && error.retryAfterSeconds
          ? error.retryAfterSeconds * 1_000
          : undefined;
      this.emitError({
        code: "ticket_failed",
        message:
          "Realtime is temporarily unavailable. Local work remains on this device.",
        permanent: false,
      });
      this.scheduleReconnect(minimumDelay);
    }
  }

  private async initializeLocalPersistence(
    documentGenerationId: string,
  ): Promise<void> {
    if (this.scope) {
      if (this.scope.documentGenerationId !== documentGenerationId) {
        throw new Error(
          "A realtime client cannot switch document generations.",
        );
      }
      return;
    }
    if (!this.persistenceInitialization) {
      this.persistenceInitialization = (async () => {
        this.scope = {
          principalId: this.options.principalId,
          boardId: this.options.boardId,
          documentGenerationId,
        };
        if (!this.outbox && typeof indexedDB !== "undefined") {
          this.outbox = new IndexedDbPendingUpdateOutbox();
        }
        const persistenceFactory =
          this.options.persistenceFactory ?? createIndexedDbDocumentPersistence;
        try {
          this.documentPersistence = persistenceFactory(
            this.scope,
            this.document,
          );
          if (this.documentPersistence?.origin) {
            this.ignoredDocumentOrigins.add(this.documentPersistence.origin);
          }
          await this.documentPersistence?.whenSynced;
          if (this.outbox) {
            const pending = await this.outbox.list(this.scope);
            this.setPendingAcknowledgementCount(pending.length);
          }
          this.storageAvailable = Boolean(
            this.documentPersistence && this.outbox,
          );
        } catch {
          this.storageAvailable = false;
        }
        if (!this.storageAvailable && !this.reportedStorageUnavailable) {
          this.reportedStorageUnavailable = true;
          this.emitError({
            code: "offline_storage_unavailable",
            message:
              "Local durable storage is unavailable, so editing is disabled for safety.",
            permanent: true,
          });
        }
      })();
    }
    await this.persistenceInitialization;
    const activeScope = this.scope as RealtimeScope | undefined;
    if (activeScope?.documentGenerationId !== documentGenerationId) {
      throw new Error("A realtime client cannot switch document generations.");
    }
  }

  private openSocket(epoch: number, ticket: RealtimeTicket): void {
    let socket: WebSocket;
    try {
      socket = this.webSocketFactory(
        resolveRealtimeUrl(this.options.realtimeUrl, undefined, {
          boardId: ticket.boardId,
          documentGenerationId: ticket.documentGenerationId,
        }),
      );
    } catch {
      this.emitError({
        code: "browser_unsupported",
        message: "The realtime connection could not be created.",
        permanent: false,
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.authenticated = false;
    this.authenticationRecoveryInProgress = false;
    this.inFlight.clear();
    this.recoveryCompactionPending = false;
    socket.binaryType = "arraybuffer";
    this.setState("connecting");

    socket.onopen = () => {
      if (
        epoch !== this.connectionEpoch ||
        this.destroyed ||
        socket !== this.socket
      )
        return;
      this.authMessageId = globalThis.crypto.randomUUID();
      this.setState("authenticating");
      socket.send(
        serializeAuthFrame({
          messageId: this.authMessageId,
          clientInstanceId: this.clientInstanceId,
          ticket: ticket.ticket,
        }),
      );
    };
    socket.onmessage = (event) => {
      if (
        epoch !== this.connectionEpoch ||
        this.destroyed ||
        socket !== this.socket
      )
        return;
      if (typeof event.data !== "string") {
        this.failPermanently(
          "protocol_error",
          "The realtime server sent a binary frame.",
        );
        return;
      }
      this.messageQueue = this.messageQueue
        .then(() => this.handleServerMessage(event.data as string, ticket))
        .catch(() => {
          this.failPermanently(
            "protocol_error",
            "The realtime server response was invalid.",
          );
        });
    };
    socket.onclose = (event) => {
      if (epoch !== this.connectionEpoch || socket !== this.socket) return;
      this.socket = undefined;
      this.authenticated = false;
      this.authenticationRecoveryInProgress = false;
      this.inFlight.clear();
      this.clearAcknowledgementTimer();
      this.clearTicketRefresh();
      if (this.destroyed || this.suppressReconnect) return;
      if (shouldStopAfterClose(event.code)) {
        this.failPermanently(
          event.code === 4403 ? "permission_denied" : "protocol_error",
          event.code === 4403
            ? "Realtime access to this board was revoked."
            : "Realtime sync stopped after a protocol rejection.",
        );
        return;
      }
      if (shouldRefreshLeaseAfterClose(event.code, event.reason)) {
        this.reconnectAttempt = 0;
        void this.openConnection();
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // The close event owns retry policy so browsers cannot trigger duplicate reconnects.
    };
  }

  private async handleServerMessage(
    raw: string,
    ticket: RealtimeTicket,
  ): Promise<void> {
    const envelope = parseServerEnvelope(raw);
    if (
      envelope.boardId !== this.options.boardId ||
      envelope.documentGenerationId !== ticket.documentGenerationId
    ) {
      throw new Error("Realtime envelope scope mismatch.");
    }
    if (
      !this.authenticated &&
      envelope.type !== "auth.ok" &&
      envelope.type !== "error"
    ) {
      throw new Error("Realtime content arrived before authentication.");
    }

    if (envelope.type === "auth.ok") {
      await this.handleAuthenticated(envelope, ticket);
    } else if (envelope.type === "auth.refreshed") {
      this.handleAuthenticationRefreshed(envelope);
    } else if (envelope.type === "sync.update") {
      await this.handleRemoteUpdate(envelope);
    } else if (envelope.type === "sync.ack") {
      await this.handleAcknowledgement(envelope);
    } else if (envelope.type === "awareness.update") {
      const update = base64ToBytes(
        envelope.payload.update,
        REALTIME_LIMITS.awarenessBytes,
      );
      this.awareness.applyRemoteUpdate(update);
      this.tabCoordinator?.post({
        type: "awareness.remote",
        update: envelope.payload.update,
      });
    } else if (envelope.type === "error") {
      this.handleServerError(envelope.payload.code);
    }
  }

  private async handleAuthenticated(
    envelope: Extract<ValidatedServerEnvelope, { type: "auth.ok" }>,
    ticket: RealtimeTicket,
  ): Promise<void> {
    if (this.authenticated || envelope.messageId !== this.authMessageId) {
      throw new Error("Unexpected realtime authentication acknowledgement.");
    }
    if (
      new Set(envelope.payload.capabilities).size !==
        envelope.payload.capabilities.length ||
      envelope.payload.capabilities.some(
        (capability) => !ticket.capabilities.includes(capability),
      )
    ) {
      throw new Error("Realtime capabilities exceed the issued ticket.");
    }
    this.authenticationRecoveryInProgress = true;
    this.setState("syncing");
    this.capabilities = [...envelope.payload.capabilities];
    invokeSafely(() => this.options.onCapabilitiesChange?.(this.capabilities));
    this.maximumUpdateBytes = envelope.payload.limits.updateBytes;
    const stateUpdate = base64ToBytes(
      envelope.payload.stateUpdate,
      REALTIME_LIMITS.snapshotBytes,
    );
    const serverDocument = new Y.Doc({ gc: true });
    Y.applyUpdate(serverDocument, stateUpdate);
    const existing =
      this.scope && this.outbox ? await this.outbox.list(this.scope) : [];
    this.setPendingAcknowledgementCount(existing.length);
    for (const pending of existing) {
      if (
        pending.update.byteLength === 0 ||
        pending.update.byteLength > this.maximumUpdateBytes ||
        (await hashBytes(pending.update)) !== pending.payloadHash
      ) {
        serverDocument.destroy();
        this.failPermanently(
          "outbox_conflict",
          "A durable local recovery update failed its integrity check.",
        );
        return;
      }
      try {
        Y.applyUpdate(this.document, pending.update, REMOTE_DOCUMENT_ORIGIN);
      } catch {
        serverDocument.destroy();
        this.failPermanently(
          "outbox_conflict",
          "A durable local recovery update could not be applied safely.",
        );
        return;
      }
    }
    const localRecoveryUpdate = Y.encodeStateAsUpdate(
      this.document,
      Y.encodeStateVector(serverDocument),
    );
    Y.applyUpdate(this.document, stateUpdate, REMOTE_DOCUMENT_ORIGIN);
    if (
      !(await this.installCommittedDocument(
        serverDocument,
        envelope.payload.sequence,
      ))
    ) {
      return;
    }
    if (envelope.payload.awarenessStateUpdate) {
      const awarenessUpdate = base64ToBytes(
        envelope.payload.awarenessStateUpdate,
        REALTIME_LIMITS.snapshotBytes,
      );
      this.awareness.applyRemoteUpdate(awarenessUpdate);
    }
    this.lastSequence = envelope.payload.sequence;
    // The server has accepted this socket and its scoped capabilities. Mark it
    // authenticated before queueing recovery bytes or replaying the durable
    // outbox; sendPendingUpdate intentionally refuses to write on an
    // unauthenticated socket.
    this.authenticated = true;
    const decodedRecovery = Y.decodeUpdate(localRecoveryUpdate);
    const hasLocalRecovery =
      decodedRecovery.structs.length > 0 || decodedRecovery.ds.clients.size > 0;
    if (
      hasLocalRecovery &&
      localRecoveryUpdate.byteLength > this.maximumUpdateBytes
    ) {
      this.failPermanently(
        "payload_too_large",
        "The durable local recovery is too large to synchronize safely as one update.",
      );
      return;
    }
    let recoveryRebased = false;
    if (
      this.scope &&
      this.outbox &&
      this.inFlight.size === 0 &&
      existing.length > 0 &&
      (!hasLocalRecovery ||
        localRecoveryUpdate.byteLength <= this.maximumUpdateBytes)
    ) {
      const replacements: PendingUpdate[] = [];
      if (hasLocalRecovery) {
        replacements.push({
          messageId: globalThis.crypto.randomUUID(),
          payloadHash: await hashBytes(localRecoveryUpdate),
          update: localRecoveryUpdate,
          createdAt: Math.min(...existing.map((update) => update.createdAt)),
          attemptCount: 0,
        });
      }
      recoveryRebased = await this.outbox.replacePending(
        this.scope,
        existing,
        replacements,
        { allowAttempted: true },
      );
      if (recoveryRebased) {
        const rebased = await this.outbox.list(this.scope);
        this.setPendingAcknowledgementCount(rebased.length);
      }
    } else if (hasLocalRecovery && existing.length === 0) {
      this.queueLocalUpdate(localRecoveryUpdate);
      await this.localUpdateQueue;
    }
    this.recoveryCompactionPending =
      !recoveryRebased && this.inFlight.size === 0;
    this.authenticationRecoveryInProgress = false;
    await this.replayOutbox();
    this.setState("connected");
    await this.broadcastOwnerSnapshot();
    this.scheduleTicketRefresh(ticket);
    this.awareness.queueCurrentState();
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
    this.stabilityTimer = setTimeout(() => {
      this.reconnectAttempt = 0;
    }, STABLE_CONNECTION_MS);
  }

  private async startConnectionOwnership(): Promise<void> {
    if (this.destroyed || this.suppressReconnect) return;
    if (this.options.documentGenerationId && !this.scope) {
      await this.initializeLocalPersistence(this.options.documentGenerationId);
    }
    if (this.destroyed || this.suppressReconnect) return;
    if (!this.scope || !this.options.documentGenerationId) {
      this.connectionOwner = true;
      this.tabCoordinator = null;
      await this.openConnection();
      return;
    }
    if (this.tabCoordinator !== undefined) {
      if (this.tabCoordinator === null || this.connectionOwner) {
        await this.openConnection();
      }
      return;
    }
    const coordinator = RealtimeTabCoordinator.create({
      scope: this.scope,
      senderId: this.clientInstanceId,
      configuration: this.options.multiTab,
      onMessage: this.handleTabMessage,
      onOwnerChange: this.handleConnectionOwnershipChange,
      onFailure: this.handleCoordinationFailure,
    });
    this.tabCoordinator = coordinator;
    if (!coordinator) {
      this.connectionOwner = true;
      await this.openConnection();
      return;
    }
    this.connectionOwner = false;
    this.setState("reconnecting");
    coordinator.start();
  }

  private readonly handleConnectionOwnershipChange = (owner: boolean): void => {
    if (this.destroyed) return;
    this.connectionOwner = owner;
    if (!owner) return;
    this.suppressReconnect = false;
    this.reconnectAttempt = 0;
    void this.openConnection();
  };

  private readonly handleCoordinationFailure = (): void => {
    if (this.destroyed) return;
    const coordinator = this.tabCoordinator;
    this.tabCoordinator = null;
    this.connectionOwner = true;
    void coordinator?.destroy();
    this.emitError({
      code: "protocol_error",
      message:
        "Cross-tab ownership was unavailable; this tab is using an independent realtime connection.",
      permanent: false,
    });
    void this.openConnection();
  };

  private readonly handleTabMessage = (message: RealtimeTabMessage): void => {
    this.multiTabMessageQueue = this.multiTabMessageQueue
      .then(() => this.handleTabMessageSafely(message))
      .catch(() => {
        this.failPermanently(
          "outbox_conflict",
          "Cross-tab realtime coordination detected inconsistent durable data.",
        );
      });
  };

  private async handleTabMessageSafely(
    message: RealtimeTabMessage,
  ): Promise<void> {
    if (this.destroyed) return;
    if (message.type === "state.request") {
      if (this.connectionOwner) {
        this.broadcastOwnerState();
        await this.broadcastOwnerSnapshot();
      }
      return;
    }
    if (message.type === "owner.state") {
      if (this.connectionOwner) return;
      this.capabilities = [...message.capabilities];
      this.committedSequence = Math.max(
        this.committedSequence,
        message.committedSequence,
      );
      this.lastSequence = Math.max(
        this.lastSequence,
        message.committedSequence,
      );
      invokeSafely(() =>
        this.options.onCapabilitiesChange?.(this.capabilities),
      );
      this.setState(message.state);
      this.flushBufferedLocalUpdates();
      await this.localUpdateQueue;
      return;
    }
    if (message.type === "document.snapshot") {
      const update = base64ToBytes(
        message.update,
        REALTIME_LIMITS.snapshotBytes,
      );
      if ((await hashBytes(update)) !== message.payloadHash) {
        throw new Error("Cross-tab snapshot hash mismatch.");
      }
      Y.applyUpdate(this.document, update, MULTI_TAB_DOCUMENT_ORIGIN);
      this.lastSequence = Math.max(
        this.lastSequence,
        message.committedSequence,
      );
      return;
    }
    if (message.type === "document.local") {
      if (!this.connectionOwner) return;
      if (!this.scope || !this.outbox) return;
      const update = base64ToBytes(message.update, this.maximumUpdateBytes);
      if ((await hashBytes(update)) !== message.payloadHash) {
        throw new Error("Cross-tab local update hash mismatch.");
      }
      const durable = (await this.outbox.list(this.scope)).find(
        (pending) => pending.messageId === message.messageId,
      );
      if (
        !durable ||
        durable.payloadHash !== message.payloadHash ||
        durable.update.byteLength !== update.byteLength ||
        !durable.update.every((value, index) => value === update[index])
      ) {
        throw new Error("Cross-tab local update was not durable.");
      }
      Y.applyUpdate(this.document, update, MULTI_TAB_DOCUMENT_ORIGIN);
      await this.requestOutboxPump();
      return;
    }
    if (message.type === "document.remote") {
      const update = base64ToBytes(message.update, this.maximumUpdateBytes);
      if ((await hashBytes(update)) !== message.payloadHash) {
        throw new Error("Cross-tab remote update hash mismatch.");
      }
      Y.applyUpdate(this.document, update, MULTI_TAB_DOCUMENT_ORIGIN);
      this.rememberRelayedCommit(message.messageId, message.payloadHash);
      this.lastSequence = Math.max(this.lastSequence, message.sequence);
      return;
    }
    if (message.type === "awareness.remote") {
      this.awareness.applyRemoteUpdate(
        base64ToBytes(message.update, REALTIME_LIMITS.awarenessBytes),
      );
      return;
    }
    await this.handleCrossTabAcknowledgement(message);
  }

  private async handleCrossTabAcknowledgement(
    message: Extract<RealtimeTabMessage, { type: "sync.ack" }>,
  ): Promise<void> {
    if (!this.scope || !this.outbox) return;
    const relayedHash = this.relayedCommittedMessageHashes.get(
      message.messageId,
    );
    const acknowledgedHash = this.acknowledgedMessageHashes.get(
      message.messageId,
    );
    if (relayedHash === undefined && acknowledgedHash === undefined) return;
    if (
      (relayedHash !== undefined && relayedHash !== message.payloadHash) ||
      (acknowledgedHash !== undefined &&
        acknowledgedHash !== message.payloadHash)
    ) {
      throw new Error("Cross-tab acknowledgement reused a message ID.");
    }
    const firstObservation = this.rememberAcknowledgement(
      message.messageId,
      message.payloadHash,
    );
    const outcome = await this.outbox.acknowledge(
      this.scope,
      message.messageId,
      message.payloadHash,
    );
    if (outcome === "hash_mismatch") {
      throw new Error("Cross-tab acknowledgement hash mismatch.");
    }
    this.inFlight.delete(message.messageId);
    const pending = await this.outbox.list(this.scope);
    this.setPendingAcknowledgementCount(pending.length);
    this.lastSequence = Math.max(this.lastSequence, message.sequence);
    if (firstObservation) {
      invokeSafely(() =>
        this.options.onUpdateAcknowledged?.(
          message.messageId,
          message.sequence,
        ),
      );
    }
  }

  private rememberAcknowledgement(
    messageId: string,
    payloadHash: string,
  ): boolean {
    const existing = this.acknowledgedMessageHashes.get(messageId);
    if (existing !== undefined) {
      if (existing !== payloadHash) {
        throw new Error(
          "An acknowledgement reused a message ID with a new hash.",
        );
      }
      return false;
    }
    this.acknowledgedMessageHashes.set(messageId, payloadHash);
    if (this.acknowledgedMessageHashes.size > MAX_REMEMBERED_ACKNOWLEDGEMENTS) {
      const oldest = this.acknowledgedMessageHashes.keys().next().value;
      if (typeof oldest === "string")
        this.acknowledgedMessageHashes.delete(oldest);
    }
    return true;
  }

  private rememberRelayedCommit(messageId: string, payloadHash: string): void {
    const existing = this.relayedCommittedMessageHashes.get(messageId);
    if (existing !== undefined && existing !== payloadHash) {
      throw new Error("A committed relay reused a message ID with a new hash.");
    }
    this.relayedCommittedMessageHashes.set(messageId, payloadHash);
    if (
      this.relayedCommittedMessageHashes.size > MAX_REMEMBERED_ACKNOWLEDGEMENTS
    ) {
      const oldest = this.relayedCommittedMessageHashes.keys().next().value;
      if (typeof oldest === "string") {
        this.relayedCommittedMessageHashes.delete(oldest);
      }
    }
  }

  private broadcastOwnerState(): void {
    if (!this.connectionOwner || !this.tabCoordinator) return;
    this.tabCoordinator.post({
      type: "owner.state",
      state: this.state,
      capabilities: [...this.capabilities],
      committedSequence: this.committedSequence,
    });
  }

  private async broadcastOwnerSnapshot(): Promise<void> {
    if (
      !this.connectionOwner ||
      !this.tabCoordinator ||
      !this.committedDocument
    ) {
      return;
    }
    const update = Y.encodeStateAsUpdate(this.committedDocument);
    this.tabCoordinator.post({
      type: "document.snapshot",
      committedSequence: this.committedSequence,
      payloadHash: await hashBytes(update),
      update: bytesToBase64(update),
    });
  }

  private handleAuthenticationRefreshed(
    envelope: Extract<ValidatedServerEnvelope, { type: "auth.refreshed" }>,
  ): void {
    const refreshTicket = this.pendingRefreshTicket;
    if (
      !refreshTicket ||
      envelope.messageId !== this.ticketRefreshMessageId ||
      new Set(envelope.payload.capabilities).size !==
        envelope.payload.capabilities.length ||
      envelope.payload.capabilities.some(
        (capability) => !refreshTicket.capabilities.includes(capability),
      ) ||
      envelope.payload.expiresAt > Date.parse(refreshTicket.expiresAt) ||
      envelope.payload.expiresAt <= Date.now()
    ) {
      throw new Error(
        "Unexpected realtime authentication refresh acknowledgement.",
      );
    }
    if (this.ticketRefreshTimer) clearTimeout(this.ticketRefreshTimer);
    this.ticketRefreshTimer = undefined;
    this.ticketRefreshMessageId = undefined;
    this.pendingRefreshTicket = undefined;
    this.ticket = refreshTicket;
    this.capabilities = [...envelope.payload.capabilities];
    invokeSafely(() => this.options.onCapabilitiesChange?.(this.capabilities));
    this.broadcastOwnerState();
    this.scheduleTicketRefresh(refreshTicket);
    if (this.capabilities.includes("write")) this.requestOutboxPump();
  }

  private scheduleTicketRefresh(ticket: RealtimeTicket): void {
    if (this.ticketRefreshTimer) clearTimeout(this.ticketRefreshTimer);
    this.ticketRefreshTimer = undefined;
    if (
      this.destroyed ||
      this.suppressReconnect ||
      !this.authenticated ||
      !isSocketOpen(this.socket)
    ) {
      return;
    }
    const expiresAt = Date.parse(ticket.expiresAt);
    const randomValue = Math.max(0, Math.min(1, this.random()));
    const refreshLeadMs =
      TICKET_REFRESH_MIN_LEAD_MS +
      randomValue *
        (TICKET_REFRESH_MAX_LEAD_MS - TICKET_REFRESH_MIN_LEAD_MS);
    const delay = Math.max(
      0,
      expiresAt - Date.now() - refreshLeadMs,
    );
    this.ticketRefreshTimer = setTimeout(() => {
      this.ticketRefreshTimer = undefined;
      void this.requestTicketRefresh();
    }, delay);
  }

  private scheduleTicketRefreshRetry(minimumDelayMs = 0): void {
    if (this.ticketRefreshTimer) clearTimeout(this.ticketRefreshTimer);
    this.ticketRefreshTimer = undefined;
    const expiresAt = this.ticket ? Date.parse(this.ticket.expiresAt) : 0;
    const availableDelay = expiresAt - Date.now() - 1_000;
    if (
      availableDelay <= 0 ||
      this.destroyed ||
      this.suppressReconnect ||
      !this.authenticated ||
      !isSocketOpen(this.socket)
    ) {
      return;
    }
    const delay = Math.max(
      250,
      Math.min(
        Math.max(minimumDelayMs, TICKET_REFRESH_RETRY_MS),
        availableDelay,
      ),
    );
    this.ticketRefreshTimer = setTimeout(() => {
      this.ticketRefreshTimer = undefined;
      this.ticketRefreshMessageId = undefined;
      this.pendingRefreshTicket = undefined;
      void this.requestTicketRefresh();
    }, delay);
  }

  private async requestTicketRefresh(): Promise<void> {
    if (
      this.destroyed ||
      this.suppressReconnect ||
      !this.authenticated ||
      !this.scope ||
      !isSocketOpen(this.socket) ||
      this.ticketRefreshAbortController
    ) {
      return;
    }
    const epoch = this.connectionEpoch;
    const socket = this.socket;
    const controller = new AbortController();
    this.ticketRefreshAbortController = controller;
    try {
      const ticket = await requestRealtimeTicket({
        boardId: this.options.boardId,
        endpoint: this.options.ticketEndpoint,
        fetchImplementation: this.options.fetchImplementation,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        epoch !== this.connectionEpoch ||
        this.destroyed ||
        !this.authenticated ||
        socket !== this.socket ||
        !isSocketOpen(socket)
      ) {
        return;
      }
      if (ticket.boardId !== this.scope.boardId) {
        this.failPermanently(
          "protocol_error",
          "The refreshed ticket does not match this board.",
        );
        return;
      }
      if (ticket.documentGenerationId !== this.scope.documentGenerationId) {
        this.failPermanently(
          "generation_changed",
          "This board was replaced. Reload it before making more changes.",
        );
        return;
      }
      this.pendingRefreshTicket = ticket;
      this.ticketRefreshMessageId = globalThis.crypto.randomUUID();
      socket.send(
        serializeAuthRefreshFrame({
          messageId: this.ticketRefreshMessageId,
          clientInstanceId: this.clientInstanceId,
          boardId: this.scope.boardId,
          documentGenerationId: this.scope.documentGenerationId,
          ticket: ticket.ticket,
        }),
      );
      this.scheduleTicketRefreshRetry();
    } catch (error) {
      if (
        controller.signal.aborted ||
        epoch !== this.connectionEpoch ||
        this.destroyed
      ) {
        return;
      }
      if (
        error instanceof RealtimeTicketRequestError &&
        (error.status === 401 || error.status === 403 || error.status === 404)
      ) {
        this.failPermanently(
          "permission_denied",
          "Realtime access to this board is no longer available.",
        );
        return;
      }
      this.emitError({
        code: "ticket_failed",
        message:
          "Realtime permission refresh is temporarily unavailable; the current session remains active.",
        permanent: false,
      });
      const minimumDelay =
        error instanceof RealtimeTicketRequestError && error.retryAfterSeconds
          ? error.retryAfterSeconds * 1_000
          : 0;
      this.scheduleTicketRefreshRetry(minimumDelay);
    } finally {
      if (this.ticketRefreshAbortController === controller) {
        this.ticketRefreshAbortController = undefined;
      }
    }
  }

  private async installCommittedDocument(
    document: Y.Doc,
    committedSequence: number,
  ): Promise<boolean> {
    const snapshot = Y.encodeStateAsUpdate(document);
    if (snapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
      document.destroy();
      this.failPermanently(
        "payload_too_large",
        "The committed realtime snapshot exceeds the recovery limit.",
      );
      return false;
    }
    this.committedDocument?.destroy();
    this.committedDocument = document;
    this.committedSequence = committedSequence;
    return this.persistCommittedRecoveryCheckpoint(snapshot);
  }

  private async advanceCommittedDocument(
    update: Uint8Array,
    committedSequence: number,
  ): Promise<boolean> {
    if (committedSequence <= this.committedSequence) return true;
    if (
      !this.committedDocument ||
      committedSequence !== this.committedSequence + 1
    ) {
      this.emitError({
        code: "protocol_error",
        message:
          "Committed realtime sequence continuity was lost; reconnecting from the server snapshot.",
        permanent: false,
      });
      this.socket?.close(CLIENT_RECONNECT_CLOSE_CODE, "committed_sequence_gap");
      return false;
    }
    const candidate = new Y.Doc({ gc: true });
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.committedDocument));
      Y.applyUpdate(candidate, update);
      const snapshot = Y.encodeStateAsUpdate(candidate);
      if (snapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
        throw new RangeError("The committed realtime snapshot is too large.");
      }
      this.committedDocument.destroy();
      this.committedDocument = candidate;
      this.committedSequence = committedSequence;
      return this.persistCommittedRecoveryCheckpoint(snapshot);
    } catch {
      candidate.destroy();
      this.failPermanently(
        "protocol_error",
        "The committed realtime update could not form a bounded recovery checkpoint.",
      );
      return false;
    }
  }

  private async persistCommittedRecoveryCheckpoint(
    snapshot: Uint8Array,
  ): Promise<boolean> {
    if (!this.scope || !this.outbox) return true;
    const checkpoint = {
      committedSequence: this.committedSequence,
      stateUpdate: new Uint8Array(snapshot),
      payloadHash: await hashBytes(snapshot),
      updatedAt: Date.now(),
    };
    const operation = this.recoveryCheckpointQueue.then(async (previous) => {
      if (!previous) return false;
      const outcome = await this.outbox!.advanceRecoveryCheckpoint(
        this.scope!,
        checkpoint,
      );
      return outcome === "advanced" || outcome === "duplicate";
    });
    this.recoveryCheckpointQueue = operation;
    try {
      if (await operation) return true;
      this.failPermanently(
        "outbox_conflict",
        "The committed recovery checkpoint attempted to move backward or change history.",
      );
    } catch {
      this.storageAvailable = false;
      this.failPermanently(
        "offline_storage_unavailable",
        "The committed recovery checkpoint could not be written to durable local storage.",
      );
    }
    return false;
  }

  private async handleRemoteUpdate(
    envelope: Extract<ValidatedServerEnvelope, { type: "sync.update" }>,
  ): Promise<void> {
    if (envelope.payload.sequence <= this.committedSequence) return;
    if (envelope.payload.sequence !== this.committedSequence + 1) {
      this.emitError({
        code: "protocol_error",
        message:
          "Realtime sequence continuity was lost; reconnecting from a durable snapshot.",
        permanent: false,
      });
      this.socket?.close(CLIENT_RECONNECT_CLOSE_CODE, "sequence_gap");
      return;
    }
    const update = base64ToBytes(
      envelope.payload.update,
      this.maximumUpdateBytes,
    );
    if ((await hashBytes(update)) !== envelope.payload.payloadHash) {
      throw new Error("Realtime update hash mismatch.");
    }
    if (
      !(await this.advanceCommittedDocument(update, envelope.payload.sequence))
    ) {
      return;
    }
    Y.applyUpdate(this.document, update, REMOTE_DOCUMENT_ORIGIN);
    this.lastSequence = envelope.payload.sequence;
    this.tabCoordinator?.post({
      type: "document.remote",
      messageId: envelope.messageId,
      sequence: envelope.payload.sequence,
      payloadHash: envelope.payload.payloadHash,
      update: envelope.payload.update,
    });
  }

  private async handleAcknowledgement(
    envelope: Extract<ValidatedServerEnvelope, { type: "sync.ack" }>,
  ): Promise<void> {
    if (!this.scope || !this.outbox)
      throw new Error("Realtime ACK arrived without an outbox.");
    const durable = (await this.outbox.list(this.scope)).find(
      (pending) => pending.messageId === envelope.messageId,
    );
    let outcome;
    try {
      outcome = await this.outbox.acknowledge(
        this.scope,
        envelope.messageId,
        envelope.payload.payloadHash,
      );
    } catch {
      this.storageAvailable = false;
      this.failPermanently(
        "offline_storage_unavailable",
        "The durable local queue could not record the server acknowledgement.",
      );
      return;
    }
    if (outcome === "hash_mismatch") {
      this.failPermanently(
        "outbox_conflict",
        "A realtime acknowledgement did not match the durable local update.",
      );
      return;
    }
    const knownHash = this.acknowledgedMessageHashes.get(envelope.messageId);
    if (outcome === "missing" && knownHash !== envelope.payload.payloadHash) {
      this.failPermanently(
        "protocol_error",
        "A realtime acknowledgement did not match a sent or previously committed update.",
      );
      return;
    }
    if (
      outcome === "acknowledged" &&
      (!durable || durable.payloadHash !== envelope.payload.payloadHash)
    ) {
      this.failPermanently(
        "outbox_conflict",
        "The durable update disappeared before its acknowledgement was committed.",
      );
      return;
    }
    if (
      durable &&
      envelope.payload.sequence > this.committedSequence &&
      !(await this.advanceCommittedDocument(
        durable.update,
        envelope.payload.sequence,
      ))
    ) {
      return;
    }
    const firstObservation = this.rememberAcknowledgement(
      envelope.messageId,
      envelope.payload.payloadHash,
    );
    this.inFlight.delete(envelope.messageId);
    this.setPendingAcknowledgementCount(
      (await this.outbox.list(this.scope)).length,
    );
    this.lastSequence = Math.max(this.lastSequence, this.committedSequence);
    if (firstObservation) {
      invokeSafely(() =>
        this.options.onUpdateAcknowledged?.(
          envelope.messageId,
          envelope.payload.sequence,
        ),
      );
    }
    if (durable) {
      this.tabCoordinator?.post({
        type: "document.remote",
        messageId: envelope.messageId,
        sequence: envelope.payload.sequence,
        payloadHash: envelope.payload.payloadHash,
        update: bytesToBase64(durable.update),
      });
    }
    this.tabCoordinator?.post({
      type: "sync.ack",
      messageId: envelope.messageId,
      sequence: envelope.payload.sequence,
      payloadHash: envelope.payload.payloadHash,
    });
    this.refreshAcknowledgementWatchdog();
    this.requestOutboxPump();
  }

  private handleServerError(code: RealtimeErrorCode): void {
    const permanent =
      code === "permission_denied" ||
      code === "generation_mismatch" ||
      code === "idempotency_conflict" ||
      code === "invalid_envelope" ||
      code === "invalid_update" ||
      code === "payload_too_large";
    if (permanent) {
      this.failPermanently(
        code,
        code === "permission_denied"
          ? "Realtime access to this board was revoked."
          : "Realtime sync stopped after a permanent protocol error.",
      );
      return;
    }
    this.emitError({
      code,
      message: "Realtime sync is temporarily unavailable; reconnecting safely.",
      permanent: false,
    });
  }

  private readonly handleDocumentUpdate = (
    update: Uint8Array,
    origin: unknown,
  ): void => {
    if (this.destroyed || this.ignoredDocumentOrigins.has(origin)) return;
    const followerAuthorizationReady = Boolean(
      this.tabCoordinator &&
      !this.connectionOwner &&
      this.capabilities.length > 0,
    );
    if (!this.ticket && !followerAuthorizationReady) {
      if (
        update.byteLength > 0 &&
        update.byteLength <= REALTIME_LIMITS.maximumUpdateBytes &&
        this.preScopeUpdateBytes + update.byteLength <=
          REALTIME_LIMITS.snapshotBytes
      ) {
        this.preScopeUpdates.push(new Uint8Array(update));
        this.preScopeUpdateBytes += update.byteLength;
      } else {
        this.emitError({
          code: "payload_too_large",
          message:
            "Local changes made before sync started exceeded the safe buffer.",
          permanent: true,
        });
      }
      return;
    }
    this.queueLocalUpdate(new Uint8Array(update));
  };

  private flushBufferedLocalUpdates(): void {
    const buffered = this.preScopeUpdates.splice(0);
    this.preScopeUpdateBytes = 0;
    for (const update of buffered) this.queueLocalUpdate(update);
  }

  private queueLocalUpdate(immutableUpdate: Uint8Array): void {
    if (
      this.capabilities.length > 0 &&
      !this.capabilities.includes("write")
    ) {
      if (!this.reportedWriteBlocked) {
        this.reportedWriteBlocked = true;
        this.emitError({
          code: "permission_denied",
          message:
            "This board is read-only, so the change was not queued for sync.",
          permanent: true,
        });
      }
      return;
    }
    this.localUpdateQueue = this.localUpdateQueue.then(async () => {
      if (!this.scope || !this.outbox || !this.storageAvailable) {
        if (!this.reportedStorageUnavailable) {
          this.reportedStorageUnavailable = true;
          this.emitError({
            code: "offline_storage_unavailable",
            message: "The change could not be placed in durable local storage.",
            permanent: true,
          });
        }
        return;
      }
      if (
        immutableUpdate.byteLength === 0 ||
        immutableUpdate.byteLength > this.maximumUpdateBytes
      ) {
        this.emitError({
          code: "payload_too_large",
          message: "This edit is too large to synchronize as one update.",
          permanent: true,
        });
        return;
      }
      const pending: PendingUpdate = {
        messageId: globalThis.crypto.randomUUID(),
        payloadHash: await hashBytes(immutableUpdate),
        update: immutableUpdate,
        createdAt: Date.now(),
        attemptCount: 0,
      };
      try {
        await this.outbox.put(this.scope, pending);
      } catch (error) {
        this.storageAvailable = false;
        this.emitError({
          code:
            error instanceof PendingUpdateConflictError
              ? "outbox_conflict"
              : "offline_storage_unavailable",
          message:
            error instanceof PendingUpdateConflictError
              ? "The local update queue rejected an immutable message identity."
              : "The change could not be written to durable local storage.",
          permanent: true,
        });
        return;
      }
      this.setPendingAcknowledgementCount(this.pendingAcknowledgementCount + 1);
      this.tabCoordinator?.post({
        type: "document.local",
        messageId: pending.messageId,
        payloadHash: pending.payloadHash,
        update: bytesToBase64(pending.update),
      });
      this.requestOutboxPump(OUTBOX_BATCH_DELAY_MS);
    });
  }

  private async replayOutbox(): Promise<void> {
    await this.requestOutboxPump();
  }

  private requestOutboxPump(delayMs = 0): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.tabCoordinator && !this.connectionOwner) return Promise.resolve();
    if (delayMs > 0) {
      if (!this.outboxPumpTimer) {
        this.outboxPumpTimer = setTimeout(() => {
          this.outboxPumpTimer = undefined;
          void this.requestOutboxPump();
        }, delayMs);
      }
      return Promise.resolve();
    }
    if (this.outboxPumpTimer) clearTimeout(this.outboxPumpTimer);
    this.outboxPumpTimer = undefined;
    this.outboxPumpRequested = true;
    if (!this.outboxPump) {
      const running = (async () => {
        while (this.outboxPumpRequested && !this.destroyed) {
          this.outboxPumpRequested = false;
          await this.pumpOutboxOnce();
        }
      })();
      this.outboxPump = running.finally(() => {
        this.outboxPump = undefined;
        if (this.outboxPumpRequested && !this.destroyed) {
          void this.requestOutboxPump();
        }
      });
    }
    return this.outboxPump;
  }

  private async pumpOutboxOnce(): Promise<void> {
    if (
      !this.scope ||
      !this.outbox ||
      (this.tabCoordinator && !this.connectionOwner) ||
      !this.capabilities.includes("write") ||
      this.authenticationRecoveryInProgress
    ) {
      return;
    }
    let updates: PendingUpdate[];
    try {
      updates = await this.outbox.list(this.scope);
      this.setPendingAcknowledgementCount(updates.length);
      const allowAttemptedCompaction =
        this.recoveryCompactionPending && this.inFlight.size === 0;
      updates = await this.compactPendingUpdates(
        updates,
        allowAttemptedCompaction,
      );
      if (allowAttemptedCompaction) this.recoveryCompactionPending = false;
    } catch {
      this.storageAvailable = false;
      this.failPermanently(
        "offline_storage_unavailable",
        "The durable local queue could not be read safely.",
      );
      return;
    }
    if (!this.authenticated || !isSocketOpen(this.socket)) return;
    const availableSlots = MAX_IN_FLIGHT_UPDATES - this.inFlight.size;
    if (availableSlots <= 0) return;
    const sendable = updates
      .filter((update) => !this.inFlight.has(update.messageId))
      .slice(0, availableSlots);
    for (const update of sendable) {
      if (!(await this.sendPendingUpdate(update))) break;
    }
  }

  private async compactPendingUpdates(
    updates: PendingUpdate[],
    allowAttempted: boolean,
  ): Promise<PendingUpdate[]> {
    if (!this.scope || !this.outbox) return updates;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const candidates = updates.filter(
        (update) =>
          !this.inFlight.has(update.messageId) &&
          (allowAttempted || update.attemptCount === 0),
      );
      if (candidates.length < 2) return updates;
      const replaced: PendingUpdate[] = [];
      const replacements: PendingUpdate[] = [];
      let index = 0;
      while (index < candidates.length) {
        const group: PendingUpdate[] = [];
        let rawBytes = 0;
        while (
          index < candidates.length &&
          group.length < MAX_COMPACTION_UPDATES
        ) {
          const candidate = candidates[index];
          if (!candidate) break;
          if (
            group.length > 0 &&
            rawBytes + candidate.update.byteLength > this.maximumUpdateBytes
          ) {
            break;
          }
          group.push(candidate);
          rawBytes += candidate.update.byteLength;
          index += 1;
        }
        if (group.length < 2) {
          if (group.length === 0) index += 1;
          continue;
        }
        const merged = Y.mergeUpdates(group.map((update) => update.update));
        if (
          merged.byteLength === 0 ||
          merged.byteLength > this.maximumUpdateBytes
        ) {
          continue;
        }
        replaced.push(...group);
        replacements.push({
          messageId: globalThis.crypto.randomUUID(),
          payloadHash: await hashBytes(merged),
          update: merged,
          createdAt: Math.min(...group.map((update) => update.createdAt)),
          attemptCount: 0,
        });
      }
      if (replaced.length < 2 || replacements.length === 0) return updates;
      if (
        await this.outbox.replacePending(this.scope, replaced, replacements, {
          allowAttempted,
        })
      ) {
        const compacted = await this.outbox.list(this.scope);
        this.setPendingAcknowledgementCount(compacted.length);
        return compacted;
      }
      updates = await this.outbox.list(this.scope);
      this.setPendingAcknowledgementCount(updates.length);
    }
    return updates;
  }

  private async sendPendingUpdate(update: PendingUpdate): Promise<boolean> {
    if (
      !this.scope ||
      !this.outbox ||
      (this.tabCoordinator && !this.connectionOwner) ||
      !this.authenticated ||
      !isSocketOpen(this.socket) ||
      !this.capabilities.includes("write") ||
      this.inFlight.has(update.messageId) ||
      this.inFlight.size >= MAX_IN_FLIGHT_UPDATES
    ) {
      return false;
    }
    this.inFlight.add(update.messageId);
    try {
      await this.outbox.markAttempt(this.scope, update.messageId, Date.now());
    } catch {
      this.inFlight.delete(update.messageId);
      this.storageAvailable = false;
      this.failPermanently(
        "offline_storage_unavailable",
        "The durable local queue could not record a retry safely.",
      );
      return false;
    }
    if (!this.authenticated || !isSocketOpen(this.socket)) {
      this.inFlight.delete(update.messageId);
      this.refreshAcknowledgementWatchdog();
      return false;
    }
    try {
      invokeSafely(() => this.options.onLocalUpdateDurable?.(update.messageId));
      this.socket.send(
        JSON.stringify({
          protocolVersion: REALTIME_PROTOCOL_VERSION,
          type: "sync.update",
          messageId: update.messageId,
          boardId: this.scope.boardId,
          documentGenerationId: this.scope.documentGenerationId,
          clientInstanceId: this.clientInstanceId,
          payload: { update: bytesToBase64(update.update) },
        }),
      );
      this.refreshAcknowledgementWatchdog();
      return true;
    } catch {
      this.inFlight.delete(update.messageId);
      this.refreshAcknowledgementWatchdog();
      this.socket.close(CLIENT_RECONNECT_CLOSE_CODE, "send_failed");
      return false;
    }
  }

  private sendAwareness(update: Uint8Array): void {
    if (
      !this.scope ||
      (this.tabCoordinator && !this.connectionOwner) ||
      !this.authenticated ||
      !isSocketOpen(this.socket) ||
      !this.capabilities.includes("awareness") ||
      update.byteLength === 0 ||
      update.byteLength > REALTIME_LIMITS.awarenessBytes
    ) {
      return;
    }
    this.socket.send(
      JSON.stringify({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "awareness.update",
        messageId: globalThis.crypto.randomUUID(),
        boardId: this.scope.boardId,
        documentGenerationId: this.scope.documentGenerationId,
        clientInstanceId: this.clientInstanceId,
        payload: { update: bytesToBase64(update) },
      }),
    );
  }

  private setPendingAcknowledgementCount(count: number): void {
    const normalized = Math.max(0, Math.floor(count));
    if (this.pendingAcknowledgementCount === normalized) return;
    this.pendingAcknowledgementCount = normalized;
    invokeSafely(() =>
      this.options.onPendingAcknowledgementCountChange?.(normalized),
    );
  }

  private clearAcknowledgementTimer(): void {
    if (this.acknowledgementTimer) clearTimeout(this.acknowledgementTimer);
    this.acknowledgementTimer = undefined;
  }

  private clearTicketRefresh(): void {
    if (this.ticketRefreshTimer) clearTimeout(this.ticketRefreshTimer);
    this.ticketRefreshTimer = undefined;
    this.ticketRefreshAbortController?.abort();
    this.ticketRefreshAbortController = undefined;
    this.ticketRefreshMessageId = undefined;
    this.pendingRefreshTicket = undefined;
  }

  private refreshAcknowledgementWatchdog(): void {
    this.clearAcknowledgementTimer();
    if (
      this.inFlight.size === 0 ||
      !this.authenticated ||
      !isSocketOpen(this.socket) ||
      this.destroyed
    ) {
      return;
    }
    this.acknowledgementTimer = setTimeout(() => {
      this.acknowledgementTimer = undefined;
      if (
        this.inFlight.size === 0 ||
        !this.authenticated ||
        !isSocketOpen(this.socket) ||
        this.destroyed
      ) {
        return;
      }
      this.emitError({
        code: "protocol_error",
        message:
          "Realtime acknowledgement stalled; reconnecting with the durable local queue.",
        permanent: false,
      });
      this.socket.close(CLIENT_RECONNECT_CLOSE_CODE, "ack_timeout");
    }, ACK_PROGRESS_TIMEOUT_MS);
  }

  private scheduleReconnect(minimumDelayMs = 0): void {
    if (
      this.destroyed ||
      this.suppressReconnect ||
      this.reconnectTimer ||
      (this.tabCoordinator && !this.connectionOwner)
    ) {
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      this.setState("offline");
      return;
    }
    if (this.reconnectAttempt >= this.reconnectPolicy.maximumAttempts) {
      this.failPermanently(
        "reconnect_exhausted",
        "Realtime could not reconnect after several safe attempts. Local updates remain queued.",
      );
      return;
    }
    const delay = Math.max(
      minimumDelayMs,
      reconnectDelayMs(
        this.reconnectAttempt,
        this.reconnectPolicy,
        this.random,
      ),
    );
    this.reconnectAttempt += 1;
    this.setState("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openConnection();
    }, delay);
  }

  private failPermanently(
    code: RealtimeClientError["code"],
    message: string,
  ): void {
    if (this.suppressReconnect && this.state === "error") return;
    this.suppressReconnect = true;
    this.authenticated = false;
    this.capabilities = [];
    invokeSafely(() => this.options.onCapabilitiesChange?.(this.capabilities));
    this.clearTimers();
    this.ticketAbortController?.abort();
    this.emitError({ code, message, permanent: true });
    this.setState(code === "permission_denied" ? "permission-denied" : "error");
    if (this.socket && this.socket.readyState < 2)
      this.socket.close(1000, "client_stopped");
  }

  private emitError(error: RealtimeClientError): void {
    invokeSafely(() => this.options.onError?.(error));
  }

  private setState(state: RealtimeConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    invokeSafely(() => this.options.onConnectionStateChange?.(state));
    this.broadcastOwnerState();
  }

  private clearTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
    if (this.outboxPumpTimer) clearTimeout(this.outboxPumpTimer);
    this.clearTicketRefresh();
    this.clearAcknowledgementTimer();
    this.reconnectTimer = undefined;
    this.stabilityTimer = undefined;
    this.outboxPumpTimer = undefined;
    this.outboxPumpRequested = false;
  }

  private readonly handleOnline = (): void => {
    if (
      this.destroyed ||
      this.suppressReconnect ||
      this.socket ||
      (this.tabCoordinator && !this.connectionOwner)
    ) {
      return;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    void this.openConnection();
  };

  private readonly handleOffline = (): void => {
    if (this.destroyed) return;
    if (this.tabCoordinator && !this.connectionOwner) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.setState("offline");
    if (this.socket && this.socket.readyState < 2)
      this.socket.close(1001, "browser_offline");
  };
}
