import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";

import WebSocket, { WebSocketServer, type RawData } from "ws";
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";

import {
  REALTIME_CLOSE,
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
  type RealtimeErrorCode,
} from "../lib/realtime/constants";
import {
  getRealtimeRuntimeEnvironment,
  type RealtimeRuntimeEnvironment,
} from "../lib/realtime/env";
import { hashRealtimePayload } from "../lib/realtime/hashing";
import { isAllowedOrigin } from "../lib/realtime/origin";
import { sanitizePresenceDisplayLabel } from "../lib/realtime/presence-identity";
import {
  decodePayload,
  encodePayload,
  parseAuthEnvelope,
  parseClientEnvelope,
  serializeServerEnvelope,
  type RealtimeClientEnvelope,
  type RealtimeServerEnvelope,
} from "../lib/realtime/protocol";
import { verifyRealtimeTicket } from "../lib/realtime/tickets";
import {
  decodeAndValidateAwarenessUpdate,
  encodeServerAuthoritativeAwarenessUpdate,
  type DecodedAwarenessEntry,
  validateYjsUpdate,
} from "../lib/realtime/yjs-validation";
import {
  RealtimePostgresPersistence,
  type RealtimeAdmission,
} from "./persistence/postgres";
import { RealtimeRoomManager } from "./rooms/manager";
import {
  REALTIME_SYNC_UPDATE_QUEUE_LIMITS,
  type RealtimeRoom,
} from "./rooms/room";

type ConnectionPhase = "authenticated" | "authenticating" | "pending";

type PendingAwareness = {
  envelope: Extract<RealtimeClientEnvelope, { type: "awareness.update" }>;
  entry: DecodedAwarenessEntry;
};

type ConnectionState = {
  socket: WebSocket;
  phase: ConnectionPhase;
  authTimer: ReturnType<typeof setTimeout>;
  admission?: RealtimeAdmission;
  clientInstanceId?: string;
  room?: RealtimeRoom;
  permissionTimer?: ReturnType<typeof setInterval>;
  permissionCheckRunning: boolean;
  permissionCheckFailures: number;
  awarenessClientId?: number;
  awarenessTimer?: ReturnType<typeof setTimeout>;
  pendingAwareness?: PendingAwareness;
  pendingSyncUpdates: number;
  lastAwarenessAt: number;
  lastPongAt: number;
};

export type FabricRealtimePersistence = Pick<
  RealtimePostgresPersistence,
  | "assertSchemaReady"
  | "cleanupExpiredEphemeralRecords"
  | "close"
  | "loadRoom"
  | "ping"
  | "persistUpdate"
  | "recheckAccess"
  | "redeemTicket"
>;

export type RealtimeUpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export type FabricRealtimeRuntimeOptions = Readonly<{
  environment?: RealtimeRuntimeEnvironment;
  persistence?: FabricRealtimePersistence;
  cleanupIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}>;

export type FabricRealtimeRuntime = Readonly<{
  start: () => Promise<void>;
  attach: (
    server: Pick<Server, "on" | "off">,
    fallback: RealtimeUpgradeHandler,
  ) => () => void;
  handleUpgrade: RealtimeUpgradeHandler;
  ready: () => Promise<boolean>;
  stop: () => Promise<void>;
  metrics: Readonly<{
    activeRooms: () => number;
    activeConnections: () => number;
    isReady: () => boolean;
  }>;
}>;

export function isFabricRealtimeUpgrade(
  request: Pick<IncomingMessage, "url">,
): boolean {
  if (!request.url) return false;
  try {
    const target = new URL(request.url, "http://fabric.internal");
    return (
      target.search === "" &&
      (target.pathname === "/realtime" ||
        /^\/realtime\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          target.pathname,
        ))
    );
  } catch {
    return false;
  }
}

export function createFabricRealtimeRuntime(
  options: FabricRealtimeRuntimeOptions = {},
): FabricRealtimeRuntime {
  const environment = options.environment ?? getRealtimeRuntimeEnvironment();
  const persistence =
    options.persistence ??
    new RealtimePostgresPersistence(environment.databaseUrl);
  const rooms = new RealtimeRoomManager(persistence);
  const serverInstanceId = randomUUID();
  const cleanupIntervalMs = Math.max(
    1_000,
    options.cleanupIntervalMs ?? 60_000,
  );
  const heartbeatIntervalMs = Math.max(
    1_000,
    options.heartbeatIntervalMs ?? 30_000,
  );
  const heartbeatTimeoutMs = Math.max(
    heartbeatIntervalMs,
    options.heartbeatTimeoutMs ?? 60_000,
  );
  let started = false;
  let ready = false;
  let stopping: Promise<void> | null = null;
  let cleanupInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  const detachAttachments = new Set<() => void>();

  function structuredLog(
    level: "error" | "info" | "warn",
    event: string,
    fields: Record<string, string | number | boolean | undefined> = {},
  ): void {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: "fabric-realtime",
      event,
      ...fields,
    });
    if (level === "error") console.error(record);
    else if (level === "warn") console.warn(record);
    else console.info(record);
  }

  function rejectUpgrade(socket: Duplex, status: 403 | 404 | 503): void {
    const label =
      status === 404
        ? "Not Found"
        : status === 503
          ? "Service Unavailable"
          : "Forbidden";
    socket.write(
      `HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nCache-Control: no-store\r\nContent-Length: 0\r\n\r\n`,
    );
    socket.destroy();
  }

  function closeSocket(
    socket: WebSocket,
    close: { code: number; reason: string },
  ): void {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close(close.code, close.reason);
    }
  }

  function authenticatedEnvelope(
    state: ConnectionState,
    type: RealtimeServerEnvelope["type"],
    messageId: string,
    payload: Record<string, unknown>,
    clientInstanceId: string = serverInstanceId,
  ): RealtimeServerEnvelope {
    const admission = state.admission;
    if (!admission)
      throw new Error("Authenticated envelope requested before admission.");
    return {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type,
      messageId,
      boardId: admission.boardId,
      documentGenerationId: admission.documentGenerationId,
      clientInstanceId,
      payload,
    };
  }

  function sendSerialized(state: ConnectionState, serialized: string): boolean {
    if (state.socket.readyState !== WebSocket.OPEN) return false;
    if (state.socket.bufferedAmount > REALTIME_LIMITS.bufferedAmountBytes) {
      recordCode("slow_consumer", state);
      closeSocket(state.socket, REALTIME_CLOSE.slowConsumer);
      return false;
    }
    state.socket.send(serialized, (error) => {
      if (error) state.socket.terminate();
    });
    return true;
  }

  function sendEnvelope(
    state: ConnectionState,
    type: RealtimeServerEnvelope["type"],
    messageId: string,
    payload: Record<string, unknown>,
    clientInstanceId?: string,
  ): boolean {
    return sendSerialized(
      state,
      serializeServerEnvelope(
        authenticatedEnvelope(
          state,
          type,
          messageId,
          payload,
          clientInstanceId,
        ),
      ),
    );
  }

  function sendError(
    state: ConnectionState,
    code: RealtimeErrorCode,
    messageId?: string,
  ): void {
    if (state.admission) {
      sendEnvelope(state, "error", messageId ?? randomUUID(), { code });
    }
    recordCode(code, state, messageId);
  }

  function recordCode(
    code: RealtimeErrorCode,
    state?: ConnectionState,
    messageId?: string,
  ): void {
    structuredLog(
      code === "internal_error" ? "error" : "warn",
      "protocol_event",
      {
        code,
        boardId: state?.admission?.boardId,
        messageId,
      },
    );
  }

  function broadcastRoom(
    room: RealtimeRoom,
    serialized: string,
    states: WeakMap<WebSocket, ConnectionState>,
    except?: WebSocket,
  ): void {
    for (const peer of room.peers) {
      if (peer === except) continue;
      const peerState = states.get(peer);
      if (peerState) sendSerialized(peerState, serialized);
    }
  }

  function verifyEnvelopeIdentity(
    state: ConnectionState,
    envelope: RealtimeClientEnvelope,
  ): boolean {
    const admission = state.admission;
    return Boolean(
      admission &&
        envelope.boardId === admission.boardId &&
        envelope.documentGenerationId === admission.documentGenerationId &&
        envelope.clientInstanceId === state.clientInstanceId,
    );
  }

  function handleSyncUpdate(
    state: ConnectionState,
    envelope: Extract<RealtimeClientEnvelope, { type: "sync.update" }>,
    states: WeakMap<WebSocket, ConnectionState>,
  ): void {
    const admission = state.admission;
    const room = state.room;
    if (!admission || !room) return;
    if (!admission.capabilities.includes("write")) {
      sendError(state, "permission_denied", envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.permissionDenied);
      return;
    }

    let update: Uint8Array;
    try {
      update = decodePayload(
        envelope.payload.update,
        REALTIME_LIMITS.updateBytes,
      );
    } catch {
      sendError(state, "payload_too_large", envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.payloadTooLarge);
      return;
    }

    if (
      state.pendingSyncUpdates >=
      REALTIME_SYNC_UPDATE_QUEUE_LIMITS.perConnection
    ) {
      sendError(state, "rate_limited", envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.rateLimited);
      return;
    }

    const queued = room.enqueueSyncUpdate(async () => {
        try {
          validateYjsUpdate(room.document, update);
        } catch {
          sendError(state, "invalid_update", envelope.messageId);
          closeSocket(state.socket, REALTIME_CLOSE.invalidEnvelope);
          return;
        }

        const payloadHash = hashRealtimePayload(update);
        const outcome = await persistence.persistUpdate({
          admission,
          messageId: envelope.messageId,
          clientInstanceId: envelope.clientInstanceId,
          update,
          payloadHash,
        });

        if (outcome.kind === "permission_denied") {
          sendError(state, "permission_denied", envelope.messageId);
          closeSocket(state.socket, REALTIME_CLOSE.permissionDenied);
          return;
        }
        if (outcome.kind === "conflict") {
          sendError(state, "idempotency_conflict", envelope.messageId);
          closeSocket(state.socket, REALTIME_CLOSE.idempotencyConflict);
          return;
        }
        if (outcome.kind === "duplicate") {
          sendEnvelope(state, "sync.ack", envelope.messageId, {
            sequence: outcome.sequence,
            duplicate: true,
            payloadHash,
          });
          return;
        }
        if (outcome.sequence !== room.lastSequence + 1) {
          throw new Error(
            "The committed sequence is not contiguous with the in-memory room.",
          );
        }

        Y.applyUpdate(room.document, update);
        room.lastSequence = outcome.sequence;
        sendEnvelope(state, "sync.ack", envelope.messageId, {
          sequence: outcome.sequence,
          duplicate: false,
          payloadHash,
        });
        const broadcast = serializeServerEnvelope(
          authenticatedEnvelope(
            state,
            "sync.update",
            envelope.messageId,
            {
              update: envelope.payload.update,
              sequence: outcome.sequence,
              payloadHash,
            },
            envelope.clientInstanceId,
          ),
        );
        broadcastRoom(room, broadcast, states, state.socket);
      });
    if (!queued.accepted) {
      const unavailable = queued.reason === "room_destroyed";
      sendError(
        state,
        unavailable ? "room_unavailable" : "rate_limited",
        envelope.messageId,
      );
      closeSocket(
        state.socket,
        unavailable
          ? REALTIME_CLOSE.roomUnavailable
          : REALTIME_CLOSE.rateLimited,
      );
      return;
    }

    state.pendingSyncUpdates += 1;
    void queued.completion
      .catch(() => {
        sendError(state, "room_unavailable", envelope.messageId);
        for (const peer of [...room.peers]) {
          const peerState = states.get(peer);
          if (peerState) peerState.room = undefined;
          closeSocket(peer, REALTIME_CLOSE.roomUnavailable);
        }
        rooms.quarantine(room);
      })
      .finally(() => {
        state.pendingSyncUpdates = Math.max(
          0,
          state.pendingSyncUpdates - 1,
        );
      });
  }

  function flushAwareness(
    state: ConnectionState,
    states: WeakMap<WebSocket, ConnectionState>,
  ): void {
    state.awarenessTimer = undefined;
    const pending = state.pendingAwareness;
    const room = state.room;
    if (!pending || !room || state.phase !== "authenticated") return;
    state.pendingAwareness = undefined;

    try {
      const admission = state.admission;
      const clientInstanceId = state.clientInstanceId;
      if (!admission || !clientInstanceId) {
        throw new Error("Authenticated presence identity is unavailable.");
      }
      const authoritativeUpdate = encodeServerAuthoritativeAwarenessUpdate(
        pending.entry,
        {
          principalId: admission.sub,
          clientInstanceId,
          displayLabel: sanitizePresenceDisplayLabel(admission.displayLabel),
        },
      );
      if (authoritativeUpdate.byteLength > REALTIME_LIMITS.awarenessBytes) {
        throw new Error("Authoritative awareness state exceeds its size limit.");
      }
      applyAwarenessUpdate(room.awareness, authoritativeUpdate, state.socket);
      state.lastAwarenessAt = Date.now();
      const broadcast = serializeServerEnvelope(
        authenticatedEnvelope(
          state,
          "awareness.update",
          pending.envelope.messageId,
          { update: encodePayload(authoritativeUpdate) },
          pending.envelope.clientInstanceId,
        ),
      );
      broadcastRoom(room, broadcast, states, state.socket);
    } catch {
      sendError(state, "invalid_awareness", pending.envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.invalidEnvelope);
    }
  }

  function handleAwarenessUpdate(
    state: ConnectionState,
    envelope: Extract<RealtimeClientEnvelope, { type: "awareness.update" }>,
    states: WeakMap<WebSocket, ConnectionState>,
  ): void {
    const admission = state.admission;
    if (!admission?.capabilities.includes("awareness")) {
      sendError(state, "permission_denied", envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.permissionDenied);
      return;
    }

    try {
      const update = decodePayload(
        envelope.payload.update,
        REALTIME_LIMITS.awarenessBytes,
      );
      const [entry] = decodeAndValidateAwarenessUpdate(update);
      if (!entry) throw new Error("The awareness update is empty.");
      if (entry.clientId === state.room?.awareness.clientID) {
        throw new Error(
          "The awareness client identity is reserved by the room runtime.",
        );
      }
      if (
        state.awarenessClientId !== undefined &&
        state.awarenessClientId !== entry.clientId
      ) {
        throw new Error(
          "The connection attempted to control another awareness client.",
        );
      }
      state.awarenessClientId = entry.clientId;
      state.pendingAwareness = { envelope, entry };
    } catch {
      sendError(state, "invalid_awareness", envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }

    if (state.awarenessTimer) return;
    const delay = Math.max(
      0,
      REALTIME_LIMITS.awarenessIntervalMs -
        (Date.now() - state.lastAwarenessAt),
    );
    state.awarenessTimer = setTimeout(
      () => flushAwareness(state, states),
      delay,
    );
  }

  function handleAuthenticatedMessage(
    state: ConnectionState,
    raw: string,
    states: WeakMap<WebSocket, ConnectionState>,
  ): void {
    let envelope: RealtimeClientEnvelope;
    try {
      envelope = parseClientEnvelope(raw);
    } catch {
      sendError(state, "invalid_envelope");
      closeSocket(state.socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }
    if (!verifyEnvelopeIdentity(state, envelope)) {
      const generationMismatch =
        envelope.documentGenerationId !== state.admission?.documentGenerationId;
      sendError(
        state,
        generationMismatch ? "generation_mismatch" : "invalid_envelope",
        envelope.messageId,
      );
      closeSocket(
        state.socket,
        generationMismatch
          ? REALTIME_CLOSE.permissionDenied
          : REALTIME_CLOSE.invalidEnvelope,
      );
      return;
    }

    if (envelope.type === "auth.refresh") {
      sendError(state, "invalid_envelope", envelope.messageId);
      closeSocket(state.socket, REALTIME_CLOSE.invalidEnvelope);
    } else if (envelope.type === "sync.update") {
      handleSyncUpdate(state, envelope, states);
    } else if (envelope.type === "awareness.update") {
      handleAwarenessUpdate(state, envelope, states);
    } else {
      sendEnvelope(state, "pong", envelope.messageId, {
        nonce: envelope.payload.nonce,
      });
    }
  }

  function startPermissionRechecks(state: ConnectionState): void {
    state.permissionTimer = setInterval(() => {
      if (state.permissionCheckRunning || !state.admission) return;
      state.permissionCheckRunning = true;
      void persistence
        .recheckAccess(state.admission)
        .then((allowed) => {
          state.permissionCheckFailures = 0;
          if (!allowed) {
            sendError(state, "permission_denied");
            closeSocket(state.socket, REALTIME_CLOSE.permissionDenied);
          }
        })
        .catch(() => {
          state.permissionCheckFailures += 1;
          recordCode("internal_error", state);
          if (state.permissionCheckFailures >= 3) {
            closeSocket(state.socket, REALTIME_CLOSE.roomUnavailable);
          }
        })
        .finally(() => {
          state.permissionCheckRunning = false;
        });
    }, REALTIME_LIMITS.permissionRecheckMs);
    state.permissionTimer.unref();
  }

  async function handleAuthentication(
    state: ConnectionState,
    raw: string,
  ): Promise<void> {
    state.phase = "pending";
    let envelope;
    try {
      envelope = parseAuthEnvelope(raw);
    } catch {
      recordCode("invalid_envelope");
      closeSocket(state.socket, REALTIME_CLOSE.authenticationFailed);
      return;
    }

    try {
      const claims = await verifyRealtimeTicket(envelope.payload.ticket, {
        key: environment.signingKey,
        issuer: environment.issuer,
        audience: environment.audience,
      });
      const redemption = await persistence.redeemTicket(
        claims,
        environment.redemptionKey,
      );
      if (redemption.kind === "replayed") {
        recordCode("ticket_replayed");
        closeSocket(state.socket, REALTIME_CLOSE.authenticationFailed);
        return;
      }
      if (redemption.kind === "permission_denied") {
        recordCode("permission_denied");
        closeSocket(state.socket, REALTIME_CLOSE.permissionDenied);
        return;
      }
      if (state.socket.readyState !== WebSocket.OPEN) return;

      const room = await rooms.getOrCreate(
        redemption.admission.boardId,
        redemption.admission.documentGenerationId,
      );
      const snapshot = Y.encodeStateAsUpdate(room.document);
      if (snapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
        recordCode("room_unavailable");
        closeSocket(state.socket, REALTIME_CLOSE.roomUnavailable);
        rooms.quarantine(room);
        return;
      }
      const awarenessClientIds = [...room.awareness.getStates().keys()].filter(
        (clientId) => clientId !== room.awareness.clientID,
      );
      const awarenessSnapshot = encodeAwarenessUpdate(
        room.awareness,
        awarenessClientIds,
      );
      const awarenessStateUpdate =
        awarenessClientIds.length > 0 &&
        snapshot.byteLength + awarenessSnapshot.byteLength <=
          REALTIME_LIMITS.snapshotBytes
          ? encodePayload(awarenessSnapshot)
          : null;

      clearTimeout(state.authTimer);
      state.admission = redemption.admission;
      state.clientInstanceId = envelope.clientInstanceId;
      state.room = room;
      state.phase = "authenticated";
      rooms.addPeer(room, state.socket);
      sendEnvelope(state, "auth.ok", envelope.messageId, {
        capabilities: redemption.admission.capabilities,
        sequence: room.lastSequence,
        stateUpdate: encodePayload(snapshot),
        awarenessStateUpdate,
        limits: {
          frameBytes: REALTIME_LIMITS.frameBytes,
          updateBytes: REALTIME_LIMITS.updateBytes,
          awarenessBytes: REALTIME_LIMITS.awarenessBytes,
        },
      });
      startPermissionRechecks(state);
    } catch {
      recordCode("authentication_failed");
      closeSocket(state.socket, REALTIME_CLOSE.authenticationFailed);
    }
  }

  function cleanupConnection(
    state: ConnectionState,
    states: WeakMap<WebSocket, ConnectionState>,
  ): void {
    clearTimeout(state.authTimer);
    if (state.permissionTimer) clearInterval(state.permissionTimer);
    if (state.awarenessTimer) clearTimeout(state.awarenessTimer);
    const room = state.room;
    if (!room) return;

    if (state.awarenessClientId !== undefined) {
      removeAwarenessStates(
        room.awareness,
        [state.awarenessClientId],
        state.socket,
      );
      const removal = encodeAwarenessUpdate(room.awareness, [
        state.awarenessClientId,
      ]);
      const broadcast = serializeServerEnvelope(
        authenticatedEnvelope(state, "awareness.update", randomUUID(), {
          update: encodePayload(removal),
        }),
      );
      broadcastRoom(room, broadcast, states, state.socket);
    }
    rooms.removePeer(room, state.socket);
  }

  function attachConnection(
    socket: WebSocket,
    states: WeakMap<WebSocket, ConnectionState>,
  ): void {
    const state: ConnectionState = {
      socket,
      phase: "authenticating",
      authTimer: setTimeout(() => {
        recordCode("authentication_timeout");
        closeSocket(socket, REALTIME_CLOSE.authenticationTimeout);
      }, REALTIME_LIMITS.authDeadlineMs),
      permissionCheckRunning: false,
      permissionCheckFailures: 0,
      pendingSyncUpdates: 0,
      lastAwarenessAt: 0,
      lastPongAt: Date.now(),
    };
    states.set(socket, state);

    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
        return;
      }
      const frameBytes = Buffer.byteLength(data as Buffer);
      const maximum =
        state.phase === "authenticated"
          ? REALTIME_LIMITS.frameBytes
          : REALTIME_LIMITS.authFrameBytes;
      if (frameBytes > maximum) {
        if (state.phase === "authenticated")
          sendError(state, "payload_too_large");
        closeSocket(socket, REALTIME_CLOSE.payloadTooLarge);
        return;
      }
      const raw = data.toString();
      if (state.phase === "authenticating") {
        void handleAuthentication(state, raw);
      } else if (state.phase === "pending") {
        closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
      } else {
        handleAuthenticatedMessage(state, raw, states);
      }
    });
    socket.once("close", () => cleanupConnection(state, states));
    socket.on("pong", () => {
      state.lastPongAt = Date.now();
    });
    socket.once("error", () => socket.terminate());
  }

  const websocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: REALTIME_LIMITS.frameBytes,
  });
  const connectionStates = new WeakMap<WebSocket, ConnectionState>();

  const handleUpgrade: RealtimeUpgradeHandler = (request, socket, head) => {
    if (!isFabricRealtimeUpgrade(request)) {
      rejectUpgrade(socket, 404);
      return;
    }
    if (!ready || stopping) {
      rejectUpgrade(socket, 503);
      return;
    }
    if (!isAllowedOrigin(request.headers.origin, environment.allowedOrigins)) {
      rejectUpgrade(socket, 403);
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  };

  websocketServer.on("connection", (socket) => {
    attachConnection(socket, connectionStates);
  });

  function startIntervals(): void {
    cleanupInterval = setInterval(() => {
      void persistence.cleanupExpiredEphemeralRecords().catch(() => {
        structuredLog("warn", "ephemeral_cleanup_failed", {
          code: "internal_error",
        });
      });
    }, cleanupIntervalMs);
    cleanupInterval.unref();

    heartbeatInterval = setInterval(() => {
      const now = Date.now();
      for (const socket of websocketServer.clients) {
        const state = connectionStates.get(socket);
        if (!state) continue;
        if (now - state.lastPongAt > heartbeatTimeoutMs) {
          socket.terminate();
          continue;
        }
        if (socket.readyState === WebSocket.OPEN) socket.ping();
      }
    }, heartbeatIntervalMs);
    heartbeatInterval.unref();
  }

  let starting: Promise<void> | null = null;

  async function start(): Promise<void> {
    if (ready) return;
    if (stopping) throw new Error("The Fabric realtime runtime is stopping.");
    if (!starting) {
      starting = persistence
        .assertSchemaReady()
        .then(() => {
          if (stopping)
            throw new Error(
              "The Fabric realtime runtime stopped during startup.",
            );
          started = true;
          ready = true;
          startIntervals();
          structuredLog("info", "runtime_ready", {
            protocolVersion: REALTIME_PROTOCOL_VERSION,
            runtimeMode: "attached",
          });
        })
        .catch((error: unknown) => {
          starting = null;
          throw error;
        });
    }
    await starting;
  }

  function attach(
    server: Pick<Server, "on" | "off">,
    fallback: RealtimeUpgradeHandler,
  ): () => void {
    if (stopping) throw new Error("The Fabric realtime runtime has stopped.");
    const listener: RealtimeUpgradeHandler = (request, socket, head) => {
      if (isFabricRealtimeUpgrade(request)) {
        handleUpgrade(request, socket, head);
        return;
      }
      fallback(request, socket, head);
    };
    let attached = true;
    const detach = () => {
      if (!attached) return;
      attached = false;
      server.off("upgrade", listener);
      detachAttachments.delete(detach);
    };
    server.on("upgrade", listener);
    detachAttachments.add(detach);
    return detach;
  }

  async function probeReady(): Promise<boolean> {
    if (!ready || stopping) return false;
    try {
      await persistence.ping();
      return ready && !stopping;
    } catch {
      return false;
    }
  }

  async function stop(): Promise<void> {
    if (stopping) return stopping;
    stopping = (async () => {
      ready = false;
      for (const detach of [...detachAttachments]) detach();
      if (cleanupInterval) clearInterval(cleanupInterval);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      cleanupInterval = null;
      heartbeatInterval = null;
      await starting?.catch(() => undefined);
      for (const socket of websocketServer.clients) {
        socket.close(1012, "service_restart");
      }
      if (started) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          websocketServer.close(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
      for (const socket of websocketServer.clients) socket.terminate();
      rooms.shutdown();
      await persistence.close();
      started = false;
      structuredLog("info", "runtime_stopped");
    })();
    return stopping;
  }

  return {
    start,
    attach,
    handleUpgrade,
    ready: probeReady,
    stop,
    metrics: {
      activeRooms: () => rooms.activeRoomCount,
      activeConnections: () => rooms.activeConnectionCount,
      isReady: () => ready && !stopping,
    },
  };
}
