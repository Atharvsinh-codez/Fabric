import { DurableObject } from "cloudflare:workers";
import * as encoding from "lib0/encoding";
import * as Y from "yjs";

import {
  REALTIME_CLOSE,
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
  type RealtimeCapability,
  type RealtimeErrorCode,
} from "../../lib/realtime/constants.ts";
import { hashRealtimePayload } from "../../lib/realtime/hashing.ts";
import { sanitizePresenceDisplayLabel } from "../../lib/realtime/presence-identity.ts";
import {
  decodePayload,
  encodePayload,
  parseAuthEnvelope,
  parseClientEnvelope,
  serializeServerEnvelope,
  type RealtimeClientEnvelope,
  type RealtimeServerEnvelope,
} from "../../lib/realtime/protocol.ts";
import {
  verifyRealtimeTicket,
  type RealtimeTicketClaims,
} from "../../lib/realtime/tickets.ts";
import {
  decodeAndValidateAwarenessUpdate,
  encodeServerAuthoritativeAwarenessUpdate,
} from "../../lib/realtime/yjs-validation.ts";

const ROOM_PATH =
  /^\/realtime\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const AUTH_SWEEP_MS = REALTIME_LIMITS.authDeadlineMs;
const SNAPSHOT_CHUNK_BYTES = 768 * 1024;
const UPDATE_CHUNK_BYTES = 768 * 1024;
const SNAPSHOT_COMPACTION_INTERVAL = 128;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const MINIMUM_RETAINED_RECEIPTS = 4_096;
const MAX_AUTHENTICATED_CONNECTIONS = 512;
const MAX_PENDING_CONNECTIONS = 256;
// Canonical fences remain epoch seconds so an in-place rollback to an older
// Worker remains safe. Existing receipt rows carry optional millisecond
// precision; modern epoch milliseconds are unambiguous at this threshold.
const MILLISECOND_FENCE_THRESHOLD = 100_000_000_000;
const SHADOW_RATE_WINDOW_MS = 10_000;
const MAX_ATTACHMENT_AWARENESS_BASE64 =
  Math.ceil((REALTIME_LIMITS.awarenessBytes * 4) / 3) + 4;
const CONNECTION_LEASE_CLOSE = {
  code: 1012,
  reason: "connection_lease_expired",
};
const ACCESS_RECHECK_CLOSE = {
  code: 1012,
  reason: "access_scope_changed",
};
const INTERNAL_REVOCATION_PATH = "/internal/revocations";
const MAX_REVOCATION_REQUEST_BYTES = 128 * 1024;
const MAX_REVOCATION_TARGETS = 25;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVOCATION_REASONS = new Set([
  "workspace.member_removed",
  "workspace.member_role_changed",
  "project.member_removed",
  "project.member_role_changed",
  "board.member_removed",
  "board.member_role_changed",
  "board.owner_changed",
  "board.archived",
  "board.access_reconfigured",
  "board.generation_replaced",
]);

type SocketClose = Readonly<{ code: number; reason: string }>;
type PendingAttachment = {
  phase: "pending";
  boardId: string;
  documentGenerationId: string;
  connectedAt: number;
  authDeadlineAt: number;
};
type AuthenticatedAttachment = {
  phase: "authenticated";
  boardId: string;
  documentGenerationId: string;
  workspaceId: string;
  principalId: string;
  clientInstanceId: string;
  displayLabel: string;
  capabilities: RealtimeCapability[];
  awarenessClientId: number | null;
  awarenessClock: number;
  awarenessUpdate: string | null;
  lastAwarenessAt: number;
  leaseExpiresAt: number;
  updateWindowStartedAt: number;
  updateWindowMessages: number;
  updateWindowBytes: number;
};
type SocketAttachment = PendingAttachment | AuthenticatedAttachment;
type BufferedWebSocket = WebSocket & { readonly bufferedAmount?: number };
type SyncUpdateEnvelope = Extract<
  RealtimeClientEnvelope,
  { type: "sync.update" }
>;
type AwarenessUpdateEnvelope = Extract<
  RealtimeClientEnvelope,
  { type: "awareness.update" }
>;
type AuthRefreshEnvelope = Extract<
  RealtimeClientEnvelope,
  { type: "auth.refresh" }
>;
type RoomRevocation = Readonly<{
  eventId: string;
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  principalId: string | null;
  action: "revoke" | "reauthorize";
  reason: string;
  invalidBefore: number;
  invalidBeforeMs?: number;
}>;
type CoordinatorRevocationBatch = Readonly<{
  workspaceId: string;
  targets: RoomRevocation[];
}>;

class InvalidRevocationRequestError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function parseRoomRevocation(value: unknown): RoomRevocation {
  const hasMillisecondCutoff =
    isRecord(value) && Object.prototype.hasOwnProperty.call(value, "invalidBeforeMs");
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "eventId",
      "workspaceId",
      "boardId",
      "documentGenerationId",
      "principalId",
      "action",
      "reason",
      "invalidBefore",
      ...(hasMillisecondCutoff ? ["invalidBeforeMs"] : []),
    ]) ||
    typeof value.eventId !== "string" ||
    !UUID_PATTERN.test(value.eventId) ||
    typeof value.workspaceId !== "string" ||
    !UUID_PATTERN.test(value.workspaceId) ||
    typeof value.boardId !== "string" ||
    !UUID_PATTERN.test(value.boardId) ||
    typeof value.documentGenerationId !== "string" ||
    !UUID_PATTERN.test(value.documentGenerationId) ||
    (value.principalId !== null &&
      (typeof value.principalId !== "string" || !UUID_PATTERN.test(value.principalId))) ||
    (value.action !== "revoke" && value.action !== "reauthorize") ||
    typeof value.reason !== "string" ||
    !REVOCATION_REASONS.has(value.reason) ||
    typeof value.invalidBefore !== "number" ||
    !Number.isSafeInteger(value.invalidBefore) ||
    value.invalidBefore < 0 ||
    (hasMillisecondCutoff &&
      (typeof value.invalidBeforeMs !== "number" ||
        !Number.isSafeInteger(value.invalidBeforeMs) ||
        value.invalidBeforeMs < 0 ||
        Math.floor(value.invalidBeforeMs / 1_000) !== value.invalidBefore))
  ) {
    throw new InvalidRevocationRequestError("Invalid revocation target.");
  }
  return {
    eventId: value.eventId,
    workspaceId: value.workspaceId,
    boardId: value.boardId,
    documentGenerationId: value.documentGenerationId,
    principalId: value.principalId,
    action: value.action,
    reason: value.reason,
    invalidBefore: value.invalidBefore,
    ...(typeof value.invalidBeforeMs === "number"
      ? { invalidBeforeMs: value.invalidBeforeMs }
      : {}),
  };
}

function ticketIsInvalidatedByFence(
  claims: RealtimeTicketClaims,
  fence: Readonly<{
    invalidBefore: number;
    latestReceiptInvalidBefore: number | null;
    preciseInvalidBefore: number | null;
  }>,
): boolean {
  if (
    claims.authorizationIssuedAtMs !== undefined &&
    fence.latestReceiptInvalidBefore !== null &&
    fence.latestReceiptInvalidBefore >= MILLISECOND_FENCE_THRESHOLD &&
    fence.preciseInvalidBefore !== null &&
    Math.floor(fence.preciseInvalidBefore / 1_000) === fence.invalidBefore
  ) {
    return claims.authorizationIssuedAtMs <= fence.preciseInvalidBefore;
  }
  // Legacy tickets, legacy receipts, pruned precision receipts, and any
  // delivery-order ambiguity retain the original conservative behavior.
  return claims.iat <= fence.invalidBefore;
}

function parseCoordinatorRevocationBatch(value: unknown): CoordinatorRevocationBatch {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["workspaceId", "targets"]) ||
    typeof value.workspaceId !== "string" ||
    !UUID_PATTERN.test(value.workspaceId) ||
    !Array.isArray(value.targets) ||
    value.targets.length < 1 ||
    value.targets.length > MAX_REVOCATION_TARGETS
  ) {
    throw new InvalidRevocationRequestError("Invalid revocation batch.");
  }
  const targets = value.targets.map(parseRoomRevocation);
  if (targets.some((target) => target.workspaceId !== value.workspaceId)) {
    throw new InvalidRevocationRequestError("Revocation workspace mismatch.");
  }
  return { workspaceId: value.workspaceId, targets };
}

async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new InvalidRevocationRequestError("Revocation request is too large.");
  }
  if (!request.body) throw new InvalidRevocationRequestError("Missing request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw new InvalidRevocationRequestError("Revocation request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const payload = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    payload.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(payload)) as unknown;
  } catch {
    throw new InvalidRevocationRequestError("Revocation request is not JSON.");
  }
}

async function hasValidCoordinatorSecret(request: Request, expected: unknown): Promise<boolean> {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const provided = match?.[1] ?? "";
  const configured = typeof expected === "string" ? expected : "";
  const encoder = new TextEncoder();
  const [providedHash, configuredHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(configured)),
  ]);
  return (
    configured.length >= 32 &&
    crypto.subtle.timingSafeEqual(providedHash, configuredHash)
  );
}

function allowedOrigins(raw: string | undefined): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => new URL(value).origin),
  );
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return allowedOrigins(env.REALTIME_ALLOWED_ORIGINS).has(
      new URL(origin).origin,
    );
  } catch {
    return false;
  }
}

function hasHealthyRuntimeConfiguration(env: Env): boolean {
  try {
    const signingKey = String(env.REALTIME_TICKET_SIGNING_KEY ?? "");
    const coordinatorSecret = String(env.REALTIME_COORDINATOR_SECRET ?? "");
    const origins = allowedOrigins(env.REALTIME_ALLOWED_ORIGINS);
    const production = env.FABRIC_ENV === "production";
    if (
      signingKey.length < 32 ||
      /(?:replace|change|placeholder|example)/i.test(signingKey) ||
      coordinatorSecret.length < 32 ||
      /(?:replace|change|placeholder|example)/i.test(coordinatorSecret) ||
      String(env.REALTIME_ISSUER ?? "").length < 3 ||
      String(env.REALTIME_AUDIENCE ?? "").length < 3 ||
      origins.size === 0 ||
      !env.FABRIC_BOARD_ROOMS ||
      typeof env.FABRIC_BOARD_ROOMS.getByName !== "function" ||
      !env.FABRIC_ACCESS_COORDINATORS ||
      typeof env.FABRIC_ACCESS_COORDINATORS.getByName !== "function"
    ) {
      return false;
    }
    for (const origin of origins) {
      const target = new URL(origin);
      if (
        production &&
        (target.protocol !== "https:" ||
          target.hostname === "localhost" ||
          target.hostname === "127.0.0.1")
      ) {
        return false;
      }
    }
    // Resolve a stub without invoking it so a missing/mistyped binding fails
    // readiness without creating room state.
    env.FABRIC_BOARD_ROOMS.getByName("fabric-health-binding-check");
    env.FABRIC_ACCESS_COORDINATORS.getByName("fabric-health-binding-check");
    return true;
  } catch {
    return false;
  }
}

function websocketResponse(client: WebSocket): Response {
  return new Response(null, { status: 101, webSocket: client });
}

function closeSocket(socket: WebSocket, close: SocketClose): void {
  try {
    socket.close(close.code, close.reason);
  } catch {
    // The peer may already have completed its close handshake.
  }
}

function sendSocket(socket: BufferedWebSocket, serialized: string): boolean {
  if (
    Number(socket.bufferedAmount ?? 0) > REALTIME_LIMITS.bufferedAmountBytes
  ) {
    closeSocket(socket, REALTIME_CLOSE.slowConsumer);
    return false;
  }
  try {
    socket.send(serialized);
    return true;
  } catch {
    closeSocket(socket, REALTIME_CLOSE.slowConsumer);
    return false;
  }
}

function asBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError("The Durable Object snapshot chunk is invalid.");
}

function awarenessRemoval(clientId: number, clock: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint(encoder, clock + 1);
  encoding.writeVarString(encoder, "null");
  return encoding.toUint8Array(encoder);
}

function createCandidateYjsDocument(
  current: Y.Doc,
  update: Uint8Array,
): { document: Y.Doc; snapshot: Uint8Array } {
  const candidate = new Y.Doc({ gc: true });
  try {
    const currentSnapshot = Y.encodeStateAsUpdate(current);
    if (currentSnapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
      throw new RangeError("The current room snapshot exceeds Fabric's limit.");
    }
    if (currentSnapshot.byteLength > 0) {
      Y.applyUpdate(candidate, currentSnapshot);
    }
    Y.applyUpdate(candidate, update);
    const snapshot = Y.encodeStateAsUpdate(candidate);
    if (snapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
      throw new RangeError(
        "The resulting room snapshot exceeds Fabric's limit.",
      );
    }
    return { document: candidate, snapshot };
  } catch (error) {
    candidate.destroy();
    throw error;
  }
}

class RoomScopeMismatchError extends Error {}

function attachmentFor(socket: WebSocket): SocketAttachment | null {
  const value: unknown = socket.deserializeAttachment();
  if (!value || typeof value !== "object" || !("phase" in value)) return null;
  const phase = (value as { phase?: unknown }).phase;
  return phase === "pending" || phase === "authenticated"
    ? (value as SocketAttachment)
    : null;
}

function authenticatedAttachment(
  socket: WebSocket,
): AuthenticatedAttachment | null {
  const attachment = attachmentFor(socket);
  return attachment?.phase === "authenticated" ? attachment : null;
}

function serverEnvelope(
  attachment: Pick<AuthenticatedAttachment, "boardId" | "documentGenerationId">,
  type: RealtimeServerEnvelope["type"],
  messageId: string,
  payload: Record<string, unknown>,
  clientInstanceId = crypto.randomUUID(),
): string {
  return serializeServerEnvelope({
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    type,
    messageId,
    boardId: attachment.boardId,
    documentGenerationId: attachment.documentGenerationId,
    clientInstanceId,
    payload,
  });
}

export class FabricBoardRoom extends DurableObject<Env> {
  private document: Y.Doc | null = null;
  private lastSequence = 0;
  private workspaceId: string | null = null;
  private boardId: string | null = null;
  private documentGenerationId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      create table if not exists room_meta (
        singleton integer primary key check (singleton = 1),
        workspace_id text,
        board_id text not null,
        document_generation_id text not null,
        last_sequence integer not null check (last_sequence >= 0),
        snapshot_sequence integer not null check (snapshot_sequence >= 0),
        snapshot_chunks integer not null check (snapshot_chunks >= 0)
      );
      create table if not exists room_snapshot_chunks (
        chunk_index integer primary key check (chunk_index >= 0),
        payload blob not null
      );
      create table if not exists room_updates (
        sequence integer primary key check (sequence > 0),
        payload_chunks integer not null check (payload_chunks > 0),
        created_at integer not null
      );
      create table if not exists room_update_chunks (
        sequence integer not null,
        chunk_index integer not null check (chunk_index >= 0),
        payload blob not null,
        primary key (sequence, chunk_index)
      );
      create table if not exists message_receipts (
        message_id text not null unique,
        sequence integer not null check (sequence > 0),
        client_instance_id text not null,
        principal_id text not null,
        payload_hash text not null,
        created_at integer not null
      );
      create index if not exists message_receipts_created_idx
        on message_receipts (created_at);
      create table if not exists redeemed_tickets (
        jti text primary key,
        expires_at integer not null
      );
      create index if not exists redeemed_tickets_expiry_idx
        on redeemed_tickets (expires_at);
      create table if not exists revocation_receipts (
        event_id text primary key,
        principal_id text,
        action text not null check (action in ('revoke', 'reauthorize')),
        reason text not null,
        invalid_before integer not null check (invalid_before >= 0),
        created_at integer not null
      );
      create table if not exists revocation_fences (
        principal_key text primary key,
        invalid_before integer not null check (invalid_before >= 0),
        updated_at integer not null
      );
    `);
    const roomMetaColumns = this.ctx.storage.sql
      .exec<{ name: string }>("pragma table_info(room_meta)")
      .toArray();
    if (!roomMetaColumns.some((column) => column.name === "workspace_id")) {
      this.ctx.storage.sql.exec(
        "alter table room_meta add column workspace_id text",
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!isAllowedOrigin(request, this.env)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Upgrade Required", { status: 426 });
    }
    const pendingConnections = this.ctx
      .getWebSockets("fabric-room")
      .filter((socket) => attachmentFor(socket)?.phase === "pending").length;
    if (pendingConnections >= MAX_PENDING_CONNECTIONS) {
      return new Response("Room capacity reached", { status: 503 });
    }

    const match = new URL(request.url).pathname.match(ROOM_PATH);
    if (!match) return new Response("Not Found", { status: 404 });
    const [, boardId, documentGenerationId] = match;
    const { 0: client, 1: server } = new WebSocketPair();
    const connectedAt = Date.now();
    server.serializeAttachment({
      phase: "pending",
      boardId,
      documentGenerationId,
      connectedAt,
      authDeadlineAt: connectedAt + AUTH_SWEEP_MS,
    } satisfies PendingAttachment);
    this.ctx.acceptWebSocket(server, ["fabric-room"]);
    await this.scheduleDeadline(connectedAt + AUTH_SWEEP_MS);
    return websocketResponse(client);
  }

  async revokeAccess(input: RoomRevocation): Promise<{
    duplicate: boolean;
    closedSockets: number;
  }> {
    const revocation = parseRoomRevocation(input);
    this.assertRevocationScope(revocation);
    const duplicate = this.ctx.storage.sql
      .exec<{ event_id: string }>(
        "select event_id from revocation_receipts where event_id = ? limit 1",
        revocation.eventId,
      )
      .toArray().length > 0;
    const now = Date.now();
    const receiptCutoff =
      revocation.invalidBeforeMs ?? revocation.invalidBefore;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `insert or ignore into revocation_receipts (
           event_id, principal_id, action, reason, invalid_before, created_at
         ) values (?, ?, ?, ?, ?, ?)`,
        revocation.eventId,
        revocation.principalId,
        revocation.action,
        revocation.reason,
        receiptCutoff,
        now,
      );
      this.ctx.storage.sql.exec(
        `insert into revocation_fences (principal_key, invalid_before, updated_at)
         values (?, ?, ?)
         on conflict (principal_key) do update set
           invalid_before = max(revocation_fences.invalid_before, excluded.invalid_before),
           updated_at = excluded.updated_at`,
        revocation.principalId ?? "*",
        revocation.invalidBefore,
        now,
      );
    });
    if (duplicate) return { duplicate: true, closedSockets: 0 };

    let closedSockets = 0;
    for (const socket of this.ctx.getWebSockets("fabric-room")) {
      const attachment = attachmentFor(socket);
      if (!attachment) continue;
      if (
        attachment.boardId !== revocation.boardId ||
        attachment.documentGenerationId !== revocation.documentGenerationId
      ) {
        continue;
      }
      if (attachment.phase === "pending") {
        if (revocation.principalId !== null || revocation.action !== "revoke") continue;
      } else if (
        attachment.workspaceId !== revocation.workspaceId ||
        (revocation.principalId !== null &&
          attachment.principalId !== revocation.principalId)
      ) {
        continue;
      }
      closeSocket(
        socket,
        revocation.action === "revoke"
          ? REALTIME_CLOSE.permissionDenied
          : ACCESS_RECHECK_CLOSE,
      );
      closedSockets += 1;
    }
    return { duplicate: false, closedSockets };
  }

  async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== "string") {
      closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }
    const attachment = attachmentFor(socket);
    if (!attachment) {
      closeSocket(socket, REALTIME_CLOSE.authenticationFailed);
      return;
    }
    const maximumFrameBytes =
      attachment.phase === "pending"
        ? REALTIME_LIMITS.authFrameBytes
        : REALTIME_LIMITS.frameBytes;
    if (new TextEncoder().encode(message).byteLength > maximumFrameBytes) {
      closeSocket(socket, REALTIME_CLOSE.payloadTooLarge);
      return;
    }
    if (attachment.phase === "pending") {
      await this.authenticate(socket, message, attachment);
      return;
    }
    if (attachment.leaseExpiresAt <= Date.now()) {
      closeSocket(socket, CONNECTION_LEASE_CLOSE);
      return;
    }
    await this.handleAuthenticatedMessage(socket, message, attachment);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    this.broadcastAwarenessRemoval(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    this.broadcastAwarenessRemoval(socket);
    closeSocket(socket, REALTIME_CLOSE.roomUnavailable);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let nextDeadline: number | null = null;
    for (const socket of this.ctx.getWebSockets("fabric-room")) {
      const attachment = attachmentFor(socket);
      if (!attachment) continue;
      const deadline =
        attachment.phase === "pending"
          ? attachment.authDeadlineAt
          : attachment.leaseExpiresAt;
      if (deadline <= now) {
        closeSocket(
          socket,
          attachment.phase === "pending"
            ? REALTIME_CLOSE.authenticationTimeout
            : CONNECTION_LEASE_CLOSE,
        );
      } else {
        nextDeadline =
          nextDeadline === null ? deadline : Math.min(nextDeadline, deadline);
      }
    }
    if (nextDeadline !== null) await this.ctx.storage.setAlarm(nextDeadline);
  }

  async authenticate(
    socket: WebSocket,
    raw: string,
    pendingAttachment: PendingAttachment,
  ): Promise<void> {
    if (pendingAttachment.authDeadlineAt <= Date.now()) {
      closeSocket(socket, REALTIME_CLOSE.authenticationTimeout);
      return;
    }
    let envelope: ReturnType<typeof parseAuthEnvelope>;
    try {
      envelope = parseAuthEnvelope(raw);
    } catch {
      closeSocket(socket, REALTIME_CLOSE.authenticationFailed);
      return;
    }

    try {
      const claims = await verifyRealtimeTicket(envelope.payload.ticket, {
        key: this.env.REALTIME_TICKET_SIGNING_KEY,
        issuer: this.env.REALTIME_ISSUER || "fabric-web",
        audience: this.env.REALTIME_AUDIENCE || "fabric-realtime",
      });
      if (
        claims.boardId !== pendingAttachment.boardId ||
        claims.documentGenerationId !== pendingAttachment.documentGenerationId
      ) {
        closeSocket(socket, REALTIME_CLOSE.permissionDenied);
        return;
      }
      if (this.isTicketRevoked(claims)) {
        closeSocket(socket, REALTIME_CLOSE.permissionDenied);
        return;
      }
      const authenticatedConnections = this.ctx
        .getWebSockets("fabric-room")
        .filter((peer) => authenticatedAttachment(peer) !== null).length;
      if (authenticatedConnections >= MAX_AUTHENTICATED_CONNECTIONS) {
        closeSocket(socket, REALTIME_CLOSE.roomUnavailable);
        return;
      }
      if (!this.redeemTicket(claims)) {
        closeSocket(socket, REALTIME_CLOSE.authenticationFailed);
        return;
      }

      const leaseExpiresAt = claims.exp * 1_000;
      if (leaseExpiresAt <= Date.now()) {
        closeSocket(socket, REALTIME_CLOSE.authenticationFailed);
        return;
      }
      const document = this.ensureDocument(
        claims.workspaceId,
        claims.boardId,
        claims.documentGenerationId,
      );
      const snapshot = Y.encodeStateAsUpdate(document);
      if (snapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
        closeSocket(socket, REALTIME_CLOSE.roomUnavailable);
        return;
      }

      const authenticated: AuthenticatedAttachment = {
        phase: "authenticated",
        boardId: claims.boardId,
        documentGenerationId: claims.documentGenerationId,
        workspaceId: claims.workspaceId,
        principalId: claims.sub,
        clientInstanceId: envelope.clientInstanceId,
        displayLabel: sanitizePresenceDisplayLabel(claims.displayLabel),
        capabilities: claims.capabilities,
        awarenessClientId: null,
        awarenessClock: 0,
        awarenessUpdate: null,
        lastAwarenessAt: 0,
        leaseExpiresAt,
        updateWindowStartedAt: Date.now(),
        updateWindowMessages: 0,
        updateWindowBytes: 0,
      };
      socket.serializeAttachment(authenticated);
      sendSocket(
        socket,
        serverEnvelope(authenticated, "auth.ok", envelope.messageId, {
          capabilities: claims.capabilities,
          sequence: this.lastSequence,
          stateUpdate: encodePayload(snapshot),
          awarenessStateUpdate: null,
          limits: {
            frameBytes: REALTIME_LIMITS.frameBytes,
            updateBytes: REALTIME_LIMITS.maximumUpdateBytes,
            awarenessBytes: REALTIME_LIMITS.awarenessBytes,
          },
        }),
      );
      for (const peer of this.ctx.getWebSockets("fabric-room")) {
        if (peer === socket) continue;
        const peerAttachment = authenticatedAttachment(peer);
        if (!peerAttachment?.awarenessUpdate) continue;
        sendSocket(
          socket,
          serverEnvelope(
            peerAttachment,
            "awareness.update",
            crypto.randomUUID(),
            { update: peerAttachment.awarenessUpdate },
            peerAttachment.clientInstanceId,
          ),
        );
      }
      await this.scheduleDeadline(authenticated.leaseExpiresAt);
    } catch (error) {
      closeSocket(
        socket,
        error instanceof RoomScopeMismatchError
          ? REALTIME_CLOSE.permissionDenied
          : REALTIME_CLOSE.authenticationFailed,
      );
    }
  }

  private redeemTicket(claims: RealtimeTicketClaims): boolean {
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "delete from redeemed_tickets where expires_at < ?",
        Math.floor(Date.now() / 1_000) - 5,
      );
      const existing = this.ctx.storage.sql
        .exec<{ jti: string }>(
          "select jti from redeemed_tickets where jti = ? limit 1",
          claims.jti,
        )
        .toArray();
      if (existing.length > 0) return false;
      this.ctx.storage.sql.exec(
        "insert into redeemed_tickets (jti, expires_at) values (?, ?)",
        claims.jti,
        claims.exp,
      );
      return true;
    });
  }

  private isTicketRevoked(claims: RealtimeTicketClaims): boolean {
    const fences = this.ctx.storage.sql
      .exec<{
        invalid_before: number;
        latest_receipt_invalid_before: number | null;
        precise_invalid_before: number | null;
      }>(
        `with ranked_receipts as (
           select
             coalesce(principal_id, '*') as principal_key,
             invalid_before,
             max(
               case when invalid_before >= ? then invalid_before else null end
             ) over (partition by coalesce(principal_id, '*')) as precise_invalid_before,
             row_number() over (
               partition by coalesce(principal_id, '*')
               order by created_at desc, rowid desc
             ) as receipt_rank
           from revocation_receipts
           where principal_id is null or principal_id = ?
         )
         select
           fence.invalid_before,
           receipt.invalid_before as latest_receipt_invalid_before,
           receipt.precise_invalid_before
         from revocation_fences as fence
         left join ranked_receipts as receipt
           on receipt.principal_key = fence.principal_key
          and receipt.receipt_rank = 1
         where fence.principal_key in ('*', ?)`,
        MILLISECOND_FENCE_THRESHOLD,
        claims.sub,
        claims.sub,
      )
      .toArray();
    return fences.some((fence) =>
      ticketIsInvalidatedByFence(claims, {
        invalidBefore: Number(fence.invalid_before),
        latestReceiptInvalidBefore:
          fence.latest_receipt_invalid_before === null
            ? null
            : Number(fence.latest_receipt_invalid_before),
        preciseInvalidBefore:
          fence.precise_invalid_before === null
            ? null
            : Number(fence.precise_invalid_before),
      }),
    );
  }

  private assertRevocationScope(revocation: RoomRevocation): void {
    const meta = this.ctx.storage.sql
      .exec<{
        workspace_id: string | null;
        board_id: string;
        document_generation_id: string;
      }>(
        `select workspace_id, board_id, document_generation_id
         from room_meta where singleton = 1 limit 1`,
      )
      .toArray()[0];
    if (
      meta &&
      (meta.board_id !== revocation.boardId ||
        meta.document_generation_id !== revocation.documentGenerationId)
    ) {
      throw new RoomScopeMismatchError("The revocation room scope is invalid.");
    }
    if (meta?.workspace_id && meta.workspace_id !== revocation.workspaceId) {
      throw new RoomScopeMismatchError("The revocation workspace scope is invalid.");
    }
    if (meta?.workspace_id === null) {
      this.ctx.storage.sql.exec(
        `update room_meta set workspace_id = ?
         where singleton = 1 and workspace_id is null`,
        revocation.workspaceId,
      );
    }
    for (const socket of this.ctx.getWebSockets("fabric-room")) {
      const attachment = attachmentFor(socket);
      if (!attachment) continue;
      if (
        attachment.boardId !== revocation.boardId ||
        attachment.documentGenerationId !== revocation.documentGenerationId ||
        (attachment.phase === "authenticated" &&
          attachment.workspaceId !== revocation.workspaceId)
      ) {
        throw new RoomScopeMismatchError("The revocation socket scope is invalid.");
      }
    }
  }

  async handleAuthenticatedMessage(
    socket: WebSocket,
    raw: string,
    attachment: AuthenticatedAttachment,
  ): Promise<void> {
    let envelope: RealtimeClientEnvelope;
    try {
      envelope = parseClientEnvelope(raw);
    } catch {
      this.sendError(socket, attachment, "invalid_envelope");
      closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }
    if (
      envelope.boardId !== attachment.boardId ||
      envelope.documentGenerationId !== attachment.documentGenerationId ||
      envelope.clientInstanceId !== attachment.clientInstanceId
    ) {
      this.sendError(
        socket,
        attachment,
        envelope.documentGenerationId !== attachment.documentGenerationId
          ? "generation_mismatch"
          : "invalid_envelope",
        envelope.messageId,
      );
      closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }

    if (envelope.type === "auth.refresh") {
      await this.handleAuthRefresh(socket, envelope, attachment);
    } else if (envelope.type === "sync.update") {
      this.handleSyncUpdate(socket, envelope, attachment);
    } else if (envelope.type === "awareness.update") {
      this.handleAwarenessUpdate(socket, envelope, attachment);
    } else {
      sendSocket(
        socket,
        serverEnvelope(attachment, "pong", envelope.messageId, {
          nonce: envelope.payload.nonce,
        }),
      );
    }
  }

  private async handleAuthRefresh(
    socket: WebSocket,
    envelope: AuthRefreshEnvelope,
    attachment: AuthenticatedAttachment,
  ): Promise<void> {
    try {
      const claims = await verifyRealtimeTicket(envelope.payload.ticket, {
        key: this.env.REALTIME_TICKET_SIGNING_KEY,
        issuer: this.env.REALTIME_ISSUER || "fabric-web",
        audience: this.env.REALTIME_AUDIENCE || "fabric-realtime",
      });
      if (
        claims.boardId !== attachment.boardId ||
        claims.documentGenerationId !== attachment.documentGenerationId ||
        claims.workspaceId !== attachment.workspaceId ||
        claims.sub !== attachment.principalId
      ) {
        this.sendError(
          socket,
          attachment,
          "permission_denied",
          envelope.messageId,
        );
        closeSocket(socket, REALTIME_CLOSE.permissionDenied);
        return;
      }
      if (this.isTicketRevoked(claims)) {
        this.sendError(
          socket,
          attachment,
          "permission_denied",
          envelope.messageId,
        );
        closeSocket(socket, REALTIME_CLOSE.permissionDenied);
        return;
      }
      this.ensureDocument(
        claims.workspaceId,
        claims.boardId,
        claims.documentGenerationId,
      );
      const leaseExpiresAt = claims.exp * 1_000;
      if (leaseExpiresAt <= Date.now() || !this.redeemTicket(claims)) {
        closeSocket(socket, REALTIME_CLOSE.authenticationFailed);
        return;
      }
      const retainsAwareness = claims.capabilities.includes("awareness");
      if (!retainsAwareness && attachment.awarenessClientId !== null) {
        this.broadcastAwarenessRemoval(socket);
      }
      const refreshed: AuthenticatedAttachment = {
        ...attachment,
        capabilities: claims.capabilities,
        awarenessClientId: retainsAwareness
          ? attachment.awarenessClientId
          : null,
        awarenessClock: retainsAwareness ? attachment.awarenessClock : 0,
        awarenessUpdate: retainsAwareness ? attachment.awarenessUpdate : null,
        lastAwarenessAt: retainsAwareness ? attachment.lastAwarenessAt : 0,
        leaseExpiresAt,
      };
      socket.serializeAttachment(refreshed);
      sendSocket(
        socket,
        serverEnvelope(refreshed, "auth.refreshed", envelope.messageId, {
          capabilities: claims.capabilities,
          expiresAt: leaseExpiresAt,
        }),
      );
      await this.scheduleDeadline(leaseExpiresAt);
    } catch (error) {
      closeSocket(
        socket,
        error instanceof RoomScopeMismatchError
          ? REALTIME_CLOSE.permissionDenied
          : REALTIME_CLOSE.authenticationFailed,
      );
    }
  }

  private handleSyncUpdate(
    socket: WebSocket,
    envelope: SyncUpdateEnvelope,
    attachment: AuthenticatedAttachment,
  ): void {
    const handlerStartedAt = performance.now();
    if (!attachment.capabilities.includes("write")) {
      this.sendError(
        socket,
        attachment,
        "permission_denied",
        envelope.messageId,
      );
      closeSocket(socket, REALTIME_CLOSE.permissionDenied);
      return;
    }

    let update: Uint8Array;
    let document: Y.Doc;
    try {
      update = decodePayload(
        envelope.payload.update,
        REALTIME_LIMITS.maximumUpdateBytes,
      );
      document = this.ensureDocument(
        attachment.workspaceId,
        attachment.boardId,
        attachment.documentGenerationId,
      );
    } catch {
      this.sendError(socket, attachment, "invalid_update", envelope.messageId);
      closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }

    const telemetryAttachment = this.recordUpdateActivity(
      socket,
      attachment,
      update.byteLength,
    );

    const payloadHash = hashRealtimePayload(update);
    const existing = this.ctx.storage.sql
      .exec<{ sequence: number; payload_hash: string }>(
        "select sequence, payload_hash from message_receipts where message_id = ? limit 1",
        envelope.messageId,
      )
      .toArray()[0];
    if (existing) {
      if (existing.payload_hash !== payloadHash) {
        this.sendError(
          socket,
          attachment,
          "idempotency_conflict",
          envelope.messageId,
        );
        closeSocket(socket, REALTIME_CLOSE.idempotencyConflict);
        return;
      }
      sendSocket(
        socket,
        serverEnvelope(attachment, "sync.ack", envelope.messageId, {
          sequence: Number(existing.sequence),
          duplicate: true,
          payloadHash,
        }),
      );
      this.emitUpdateShadowTelemetry({
        attachment: telemetryAttachment,
        updateBytes: update.byteLength,
        sequence: existing.sequence,
        duplicate: true,
        handlerStartedAt,
        storageLatencyMs: 0,
        fanoutLatencyMs: 0,
        fanout: 0,
      });
      return;
    }

    let candidate: { document: Y.Doc; snapshot: Uint8Array };
    try {
      candidate = createCandidateYjsDocument(document, update);
    } catch {
      this.sendError(socket, attachment, "invalid_update", envelope.messageId);
      closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
      return;
    }

    const sequence = this.lastSequence + 1;
    const storageStartedAt = performance.now();
    let candidateAdopted = false;
    try {
      this.ctx.storage.transactionSync(() => {
        const chunks: Uint8Array[] = [];
        for (
          let offset = 0;
          offset < update.byteLength;
          offset += UPDATE_CHUNK_BYTES
        ) {
          chunks.push(update.slice(offset, offset + UPDATE_CHUNK_BYTES));
        }
        this.ctx.storage.sql.exec(
          `insert into message_receipts (
             message_id, sequence, client_instance_id, principal_id,
             payload_hash, created_at
           ) values (?, ?, ?, ?, ?, ?)`,
          envelope.messageId,
          sequence,
          attachment.clientInstanceId,
          attachment.principalId,
          payloadHash,
          Date.now(),
        );
        this.ctx.storage.sql.exec(
          `insert into room_updates (sequence, payload_chunks, created_at)
           values (?, ?, ?)`,
          sequence,
          chunks.length,
          Date.now(),
        );
        for (let index = 0; index < chunks.length; index += 1) {
          this.ctx.storage.sql.exec(
            `insert into room_update_chunks (sequence, chunk_index, payload)
             values (?, ?, ?)`,
            sequence,
            index,
            chunks[index],
          );
        }
        this.lastSequence = sequence;
        if (sequence % SNAPSHOT_COMPACTION_INTERVAL === 0) {
          this.persistSnapshot(
            attachment.workspaceId,
            attachment.boardId,
            attachment.documentGenerationId,
            candidate.snapshot,
          );
        } else {
          this.persistHead(
            attachment.workspaceId,
            attachment.boardId,
            attachment.documentGenerationId,
          );
        }
      });
      this.document = candidate.document;
      candidateAdopted = true;
      document.destroy();
    } catch {
      if (!candidateAdopted) candidate.document.destroy();
      try {
        this.reloadDocument(
          attachment.workspaceId,
          attachment.boardId,
          attachment.documentGenerationId,
        );
      } catch {
        this.resetLoadedDocument();
      }
      this.sendError(
        socket,
        attachment,
        "room_unavailable",
        envelope.messageId,
      );
      closeSocket(socket, REALTIME_CLOSE.roomUnavailable);
      return;
    }
    const storageLatencyMs = performance.now() - storageStartedAt;

    // Durable Object storage commits before either acknowledgement or broadcast.
    sendSocket(
      socket,
      serverEnvelope(attachment, "sync.ack", envelope.messageId, {
        sequence,
        duplicate: false,
        payloadHash,
      }),
    );
    const remoteFrame = serverEnvelope(
      attachment,
      "sync.update",
      envelope.messageId,
      { update: envelope.payload.update, sequence, payloadHash },
      attachment.clientInstanceId,
    );
    const fanoutStartedAt = performance.now();
    const fanout = this.broadcast(remoteFrame, socket);
    const fanoutLatencyMs = performance.now() - fanoutStartedAt;
    this.emitUpdateShadowTelemetry({
      attachment: telemetryAttachment,
      updateBytes: update.byteLength,
      sequence,
      duplicate: false,
      handlerStartedAt,
      storageLatencyMs,
      fanoutLatencyMs,
      fanout,
    });
  }

  private recordUpdateActivity(
    socket: WebSocket,
    attachment: AuthenticatedAttachment,
    updateBytes: number,
  ): AuthenticatedAttachment {
    const now = Date.now();
    const existingStartedAt = Number(attachment.updateWindowStartedAt);
    const continuesWindow =
      Number.isFinite(existingStartedAt) &&
      existingStartedAt > 0 &&
      now - existingStartedAt < SHADOW_RATE_WINDOW_MS;
    const nextAttachment: AuthenticatedAttachment = {
      ...attachment,
      updateWindowStartedAt: continuesWindow ? existingStartedAt : now,
      updateWindowMessages:
        (continuesWindow ? Number(attachment.updateWindowMessages) || 0 : 0) +
        1,
      updateWindowBytes:
        (continuesWindow ? Number(attachment.updateWindowBytes) || 0 : 0) +
        updateBytes,
    };
    socket.serializeAttachment(nextAttachment);
    return nextAttachment;
  }

  private emitUpdateShadowTelemetry(input: {
    attachment: AuthenticatedAttachment;
    updateBytes: number;
    sequence: number;
    duplicate: boolean;
    handlerStartedAt: number;
    storageLatencyMs: number;
    fanoutLatencyMs: number;
    fanout: number;
  }): void {
    const elapsedWindowMs = Math.max(
      1,
      Date.now() - input.attachment.updateWindowStartedAt,
    );
    const authenticatedConnections = this.ctx
      .getWebSockets("fabric-room")
      .filter((peer) => authenticatedAttachment(peer) !== null).length;
    const round = (value: number): number => Math.round(value * 100) / 100;
    console.log(
      JSON.stringify({
        event: "fabric.realtime.update.shadow",
        enforcement: "shadow",
        boardId: input.attachment.boardId,
        documentGenerationId: input.attachment.documentGenerationId,
        principalId: input.attachment.principalId,
        clientInstanceId: input.attachment.clientInstanceId,
        sequence: input.sequence,
        duplicate: input.duplicate,
        updateBytes: input.updateBytes,
        rate: {
          windowMs: elapsedWindowMs,
          messages: input.attachment.updateWindowMessages,
          bytes: input.attachment.updateWindowBytes,
          messagesPerSecond: round(
            (input.attachment.updateWindowMessages * 1_000) / elapsedWindowMs,
          ),
          bytesPerSecond: round(
            (input.attachment.updateWindowBytes * 1_000) / elapsedWindowMs,
          ),
        },
        latencyMs: {
          handler: round(performance.now() - input.handlerStartedAt),
          storage: round(input.storageLatencyMs),
          fanout: round(input.fanoutLatencyMs),
        },
        fanout: {
          delivered: input.fanout,
          authenticatedConnections,
        },
      }),
    );
  }

  private handleAwarenessUpdate(
    socket: WebSocket,
    envelope: AwarenessUpdateEnvelope,
    attachment: AuthenticatedAttachment,
  ): void {
    if (!attachment.capabilities.includes("awareness")) {
      this.sendError(
        socket,
        attachment,
        "permission_denied",
        envelope.messageId,
      );
      closeSocket(socket, REALTIME_CLOSE.permissionDenied);
      return;
    }
    try {
      const update = decodePayload(
        envelope.payload.update,
        REALTIME_LIMITS.awarenessBytes,
      );
      const [entry] = decodeAndValidateAwarenessUpdate(update);
      if (!entry) throw new Error("Missing awareness entry.");
      if (
        attachment.awarenessClientId !== null &&
        attachment.awarenessClientId !== entry.clientId
      ) {
        throw new Error("Awareness identity changed.");
      }
      if (
        attachment.awarenessClientId === entry.clientId &&
        entry.clock <= attachment.awarenessClock
      ) {
        return;
      }
      const authoritativeUpdate = encodeServerAuthoritativeAwarenessUpdate(
        entry,
        attachment,
      );
      if (authoritativeUpdate.byteLength > REALTIME_LIMITS.awarenessBytes) {
        throw new Error(
          "Authoritative awareness state exceeds its size limit.",
        );
      }
      const authoritativePayload = encodePayload(authoritativeUpdate);
      const now = Date.now();
      if (
        attachment.lastAwarenessAt > 0 &&
        now - attachment.lastAwarenessAt < REALTIME_LIMITS.awarenessIntervalMs
      ) {
        return;
      }
      const nextAttachment: AuthenticatedAttachment = {
        ...attachment,
        awarenessClientId: entry.clientId,
        awarenessClock: entry.clock,
        awarenessUpdate:
          authoritativePayload.length <= MAX_ATTACHMENT_AWARENESS_BASE64
            ? authoritativePayload
            : null,
        lastAwarenessAt: now,
      };
      socket.serializeAttachment(nextAttachment);
      this.broadcast(
        serverEnvelope(
          nextAttachment,
          "awareness.update",
          envelope.messageId,
          { update: authoritativePayload },
          attachment.clientInstanceId,
        ),
        socket,
      );
    } catch {
      this.sendError(
        socket,
        attachment,
        "invalid_awareness",
        envelope.messageId,
      );
      closeSocket(socket, REALTIME_CLOSE.invalidEnvelope);
    }
  }

  private ensureDocument(
    workspaceId: string,
    boardId: string,
    documentGenerationId: string,
  ): Y.Doc {
    if (this.document) {
      if (
        this.workspaceId !== workspaceId ||
        this.boardId !== boardId ||
        this.documentGenerationId !== documentGenerationId
      ) {
        throw new RoomScopeMismatchError(
          "The Durable Object was routed to the wrong room scope.",
        );
      }
      return this.document;
    }
    return this.reloadDocument(workspaceId, boardId, documentGenerationId);
  }

  private reloadDocument(
    workspaceId: string,
    boardId: string,
    documentGenerationId: string,
  ): Y.Doc {
    const document = new Y.Doc({ gc: true });
    try {
      const meta = this.ctx.storage.sql
        .exec<{
          workspace_id: string | null;
          board_id: string;
          document_generation_id: string;
          last_sequence: number;
          snapshot_sequence: number;
          snapshot_chunks: number;
        }>(
          `select workspace_id, board_id, document_generation_id,
                  last_sequence, snapshot_sequence, snapshot_chunks
           from room_meta where singleton = 1 limit 1`,
        )
        .toArray()[0];
      if (!meta) {
        this.installLoadedDocument(
          document,
          workspaceId,
          boardId,
          documentGenerationId,
          0,
        );
        return document;
      }
      if (
        meta.board_id !== boardId ||
        meta.document_generation_id !== documentGenerationId
      ) {
        throw new RoomScopeMismatchError(
          "The Durable Object was routed to the wrong room scope.",
        );
      }
      if (meta.workspace_id === null) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            `update room_meta set workspace_id = ?
             where singleton = 1 and workspace_id is null`,
            workspaceId,
          );
        });
      } else if (meta.workspace_id !== workspaceId) {
        throw new RoomScopeMismatchError(
          "The Durable Object was routed to the wrong workspace.",
        );
      }

      const boundWorkspace = this.ctx.storage.sql
        .exec<{ workspace_id: string | null }>(
          "select workspace_id from room_meta where singleton = 1 limit 1",
        )
        .toArray()[0]?.workspace_id;
      if (boundWorkspace !== workspaceId) {
        throw new RoomScopeMismatchError(
          "The Durable Object workspace binding is invalid.",
        );
      }

      const chunks = this.ctx.storage.sql
        .exec<{ chunk_index: number; payload: ArrayBuffer }>(
          "select chunk_index, payload from room_snapshot_chunks order by chunk_index asc",
        )
        .toArray();
      if (chunks.length !== Number(meta.snapshot_chunks)) {
        throw new Error("The Durable Object snapshot is incomplete.");
      }
      const byteLength = chunks.reduce(
        (total, chunk) => total + asBytes(chunk.payload).byteLength,
        0,
      );
      if (byteLength > REALTIME_LIMITS.snapshotBytes) {
        throw new Error("The Durable Object snapshot exceeds Fabric's limit.");
      }
      const snapshot = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        const bytes = asBytes(chunk.payload);
        snapshot.set(bytes, offset);
        offset += bytes.byteLength;
      }
      if (snapshot.byteLength > 0) Y.applyUpdate(document, snapshot);
      const snapshotSequence = Number(meta.snapshot_sequence);
      const lastSequence = Number(meta.last_sequence);
      const updates = this.ctx.storage.sql
        .exec<{ sequence: number; payload_chunks: number }>(
          `select sequence, payload_chunks from room_updates
           where sequence > ? order by sequence asc`,
          snapshotSequence,
        )
        .toArray();
      let expected = snapshotSequence + 1;
      for (const row of updates) {
        if (Number(row.sequence) !== expected || expected > lastSequence) {
          throw new Error(
            "The Durable Object update history has a sequence gap.",
          );
        }
        Y.applyUpdate(
          document,
          this.readUpdatePayload(
            Number(row.sequence),
            Number(row.payload_chunks),
          ),
        );
        expected += 1;
      }
      if (expected - 1 !== lastSequence) {
        throw new Error(
          "The Durable Object snapshot is missing committed updates.",
        );
      }
      const resultingSnapshot = Y.encodeStateAsUpdate(document);
      if (resultingSnapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
        throw new Error("The resulting Durable Object snapshot is too large.");
      }
      this.installLoadedDocument(
        document,
        workspaceId,
        boardId,
        documentGenerationId,
        lastSequence,
      );
      return document;
    } catch (error) {
      document.destroy();
      throw error;
    }
  }

  private installLoadedDocument(
    document: Y.Doc,
    workspaceId: string,
    boardId: string,
    documentGenerationId: string,
    lastSequence: number,
  ): void {
    this.document?.destroy();
    this.document = document;
    this.workspaceId = workspaceId;
    this.boardId = boardId;
    this.documentGenerationId = documentGenerationId;
    this.lastSequence = lastSequence;
  }

  private resetLoadedDocument(): void {
    this.document?.destroy();
    this.document = null;
    this.workspaceId = null;
    this.boardId = null;
    this.documentGenerationId = null;
    this.lastSequence = 0;
  }

  private readUpdatePayload(
    sequence: number,
    expectedChunks: number,
  ): Uint8Array {
    const rows = this.ctx.storage.sql
      .exec<{ chunk_index: number; payload: ArrayBuffer }>(
        `select chunk_index, payload from room_update_chunks
         where sequence = ? order by chunk_index asc`,
        sequence,
      )
      .toArray();
    if (rows.length !== expectedChunks || expectedChunks < 1) {
      throw new Error("A Durable Object update is missing payload chunks.");
    }
    const byteLength = rows.reduce((total, row, index) => {
      if (Number(row.chunk_index) !== index) {
        throw new Error("A Durable Object update has a chunk sequence gap.");
      }
      const chunk = asBytes(row.payload);
      if (chunk.byteLength < 1 || chunk.byteLength > UPDATE_CHUNK_BYTES) {
        throw new Error(
          "A Durable Object update chunk violates its size limit.",
        );
      }
      return total + chunk.byteLength;
    }, 0);
    if (byteLength > REALTIME_LIMITS.maximumUpdateBytes) {
      throw new Error("A Durable Object update exceeds Fabric's size limit.");
    }
    const update = new Uint8Array(byteLength);
    let offset = 0;
    for (const row of rows) {
      const chunk = asBytes(row.payload);
      update.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return update;
  }

  private persistSnapshot(
    workspaceId: string,
    boardId: string,
    documentGenerationId: string,
    snapshot: Uint8Array,
  ): void {
    if (snapshot.byteLength > REALTIME_LIMITS.snapshotBytes) {
      throw new Error("The room snapshot exceeds Fabric's safety limit.");
    }
    const chunks: Uint8Array[] = [];
    for (
      let offset = 0;
      offset < snapshot.byteLength;
      offset += SNAPSHOT_CHUNK_BYTES
    ) {
      chunks.push(snapshot.slice(offset, offset + SNAPSHOT_CHUNK_BYTES));
    }
    this.ctx.storage.sql.exec("delete from room_snapshot_chunks");
    for (let index = 0; index < chunks.length; index += 1) {
      this.ctx.storage.sql.exec(
        "insert into room_snapshot_chunks (chunk_index, payload) values (?, ?)",
        index,
        chunks[index],
      );
    }
    this.ctx.storage.sql.exec(
      `insert into room_meta (
         singleton, workspace_id, board_id, document_generation_id, last_sequence,
         snapshot_sequence, snapshot_chunks
       ) values (1, ?, ?, ?, ?, ?, ?)
       on conflict(singleton) do update set
         last_sequence = excluded.last_sequence,
         snapshot_sequence = excluded.snapshot_sequence,
         snapshot_chunks = excluded.snapshot_chunks`,
      workspaceId,
      boardId,
      documentGenerationId,
      this.lastSequence,
      this.lastSequence,
      chunks.length,
    );
    this.ctx.storage.sql.exec(
      `delete from room_update_chunks
       where sequence in (select sequence from room_updates where sequence <= ?)`,
      this.lastSequence,
    );
    this.ctx.storage.sql.exec(
      "delete from room_updates where sequence <= ?",
      this.lastSequence,
    );
    this.ctx.storage.sql.exec(
      `delete from message_receipts
       where created_at < ? and sequence < ?`,
      Date.now() - RECEIPT_RETENTION_MS,
      Math.max(1, this.lastSequence - MINIMUM_RETAINED_RECEIPTS),
    );
  }

  private persistHead(
    workspaceId: string,
    boardId: string,
    documentGenerationId: string,
  ): void {
    this.ctx.storage.sql.exec(
      `insert into room_meta (
         singleton, workspace_id, board_id, document_generation_id, last_sequence,
         snapshot_sequence, snapshot_chunks
       ) values (1, ?, ?, ?, ?, 0, 0)
       on conflict(singleton) do update set
         last_sequence = excluded.last_sequence`,
      workspaceId,
      boardId,
      documentGenerationId,
      this.lastSequence,
    );
  }

  private broadcast(serialized: string, except?: WebSocket): number {
    let delivered = 0;
    for (const peer of this.ctx.getWebSockets("fabric-room")) {
      if (peer === except || !authenticatedAttachment(peer)) continue;
      if (sendSocket(peer, serialized)) delivered += 1;
    }
    return delivered;
  }

  private broadcastAwarenessRemoval(socket: WebSocket): void {
    const attachment = authenticatedAttachment(socket);
    if (!attachment || attachment.awarenessClientId === null) return;
    const update = awarenessRemoval(
      attachment.awarenessClientId,
      attachment.awarenessClock,
    );
    this.broadcast(
      serverEnvelope(attachment, "awareness.update", crypto.randomUUID(), {
        update: encodePayload(update),
      }),
      socket,
    );
  }

  private sendError(
    socket: WebSocket,
    attachment: AuthenticatedAttachment,
    code: RealtimeErrorCode,
    messageId = crypto.randomUUID(),
  ): void {
    try {
      sendSocket(
        socket,
        serverEnvelope(attachment, "error", messageId, { code }),
      );
    } catch {
      // A close immediately follows permanent protocol failures.
    }
  }

  private async scheduleDeadline(deadline: number): Promise<void> {
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > deadline) {
      await this.ctx.storage.setAlarm(deadline);
    }
  }
}

export class WorkspaceAccessCoordinator extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      create table if not exists coordinator_meta (
        singleton integer primary key check (singleton = 1),
        workspace_id text not null
      );
    `);
  }

  async revokeAccess(input: CoordinatorRevocationBatch): Promise<{
    deliveredRooms: number;
    duplicateRooms: number;
    closedSockets: number;
  }> {
    const batch = parseCoordinatorRevocationBatch(input);
    this.bindWorkspace(batch.workspaceId);
    let deliveredRooms = 0;
    let duplicateRooms = 0;
    let closedSockets = 0;
    const concurrency = 5;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(concurrency, batch.targets.length) }, async () => {
        while (cursor < batch.targets.length) {
          const target = batch.targets[cursor++];
          if (!target) return;
          const room = this.env.FABRIC_BOARD_ROOMS.getByName(
            `${target.boardId}:${target.documentGenerationId}`,
          );
          const result = await room.revokeAccess(target);
          deliveredRooms += 1;
          duplicateRooms += Number(result.duplicate);
          closedSockets += result.closedSockets;
        }
      }),
    );
    return { deliveredRooms, duplicateRooms, closedSockets };
  }

  private bindWorkspace(workspaceId: string): void {
    this.ctx.storage.transactionSync(() => {
      const existing = this.ctx.storage.sql
        .exec<{ workspace_id: string }>(
          "select workspace_id from coordinator_meta where singleton = 1 limit 1",
        )
        .toArray()[0]?.workspace_id;
      if (existing && existing !== workspaceId) {
        throw new RoomScopeMismatchError("The access coordinator workspace is invalid.");
      }
      if (!existing) {
        this.ctx.storage.sql.exec(
          "insert into coordinator_meta (singleton, workspace_id) values (1, ?)",
          workspaceId,
        );
      }
    });
  }
}

const worker: ExportedHandler<Env> = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const target = new URL(request.url);
    if (target.pathname === "/" && request.method === "GET") {
      if (!hasHealthyRuntimeConfiguration(env)) {
        return Response.json(
          { status: "unavailable", service: "fabric-realtime" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        {
          status: "ok",
          service: "fabric-realtime",
          transport: "cloudflare-durable-objects",
          websocketPath: "/realtime/{boardId}/{documentGenerationId}",
          message: "Fabric realtime is online. Connect through the Fabric app.",
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (target.pathname === "/health" && request.method === "GET") {
      if (!hasHealthyRuntimeConfiguration(env)) {
        return Response.json(
          { status: "unavailable" },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { status: "ok", transport: "cloudflare-durable-objects" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    if (
      target.pathname === INTERNAL_REVOCATION_PATH &&
      request.method === "POST" &&
      !target.search
    ) {
      if (!(await hasValidCoordinatorSecret(request, env.REALTIME_COORDINATOR_SECRET))) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "Cache-Control": "no-store" },
        });
      }
      try {
        const batch = parseCoordinatorRevocationBatch(
          await readBoundedJson(request, MAX_REVOCATION_REQUEST_BYTES),
        );
        const coordinator = env.FABRIC_ACCESS_COORDINATORS.getByName(
          batch.workspaceId,
        );
        const result = await coordinator.revokeAccess(batch);
        return Response.json(result, {
          status: 200,
          headers: { "Cache-Control": "no-store" },
        });
      } catch (error) {
        if (error instanceof InvalidRevocationRequestError) {
          return new Response("Invalid request", {
            status: 400,
            headers: { "Cache-Control": "no-store" },
          });
        }
        console.error(
          JSON.stringify({
            event: "fabric.realtime.revocation.failed",
            error: "coordinator_delivery_failed",
          }),
        );
        return new Response("Unavailable", {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        });
      }
    }
    const match = target.pathname.match(ROOM_PATH);
    if (!match || target.search || request.method !== "GET") {
      return new Response("Not Found", { status: 404 });
    }
    if (!isAllowedOrigin(request, env)) {
      return new Response("Forbidden", { status: 403 });
    }
    const [, boardId, documentGenerationId] = match;
    const room = env.FABRIC_BOARD_ROOMS.getByName(
      `${boardId}:${documentGenerationId}`,
    );
    return room.fetch(request);
  },
};

export default worker;
