import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { REALTIME_LIMITS, REALTIME_PROTOCOL_VERSION } from "../constants";
import { DEFAULT_RECONNECT_POLICY } from "./backoff";
import { bytesToBase64, hashBytes } from "./encoding";
import { MemoryPendingUpdateOutbox } from "./persistence";
import { FabricRealtimeClient } from "./realtime-client";
import type {
  DocumentPersistenceFactory,
  PendingUpdate,
  RealtimeScope,
} from "./types";
import type { RealtimeTicket } from "./ticket";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_GENERATION_ID = "33333333-3333-4333-8333-333333333333";

const scope: RealtimeScope = {
  principalId: PRINCIPAL_ID,
  boardId: BOARD_ID,
  documentGenerationId: DOCUMENT_GENERATION_ID,
};

const persistenceFactory: DocumentPersistenceFactory = () => ({
  origin: {},
  whenSynced: Promise.resolve(),
  destroy: async () => undefined,
  clearData: async () => undefined,
});

class FakeSocket {
  readyState = 1;
  readonly sent: string[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  onclose: ((event: CloseEvent) => void) | null = null;

  send(frame: string): void {
    this.sent.push(frame);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.onclose?.({ code: code ?? 1000, reason: reason ?? "" } as CloseEvent);
  }
}

type RealtimeClientInternals = {
  authenticated: boolean;
  authMessageId?: string;
  capabilities: string[];
  committedDocument?: Y.Doc;
  committedSequence: number;
  connectionOwner: boolean;
  handleAuthenticated: (envelope: unknown, ticket: unknown) => Promise<void>;
  handleAuthenticationRefreshed: (envelope: unknown) => void;
  handleAcknowledgement: (envelope: unknown) => Promise<void>;
  localUpdateQueue: Promise<void>;
  outboxPump?: Promise<void>;
  queueLocalUpdate: (update: Uint8Array) => void;
  requestOutboxPump: (delayMs?: number) => Promise<void>;
  requestTicketRefresh: () => Promise<void>;
  scheduleTicketRefresh: (ticket: RealtimeTicket) => void;
  socket?: WebSocket;
  state: string;
  tabCoordinator?: {
    destroy: () => Promise<void>;
    post: (message: unknown) => void;
  } | null;
  ticket?: RealtimeTicket;
};

function internals(client: FabricRealtimeClient): RealtimeClientInternals {
  return client as unknown as RealtimeClientInternals;
}

function createYjsUpdates(count: number): Uint8Array[] {
  const document = new Y.Doc();
  const updates: Uint8Array[] = [];
  document.on("update", (update) => updates.push(new Uint8Array(update)));
  const records = document.getMap<number>("records");
  for (let index = 0; index < count; index += 1) {
    records.set(`record-${index}`, index);
  }
  document.destroy();
  return updates;
}

async function pendingUpdate(
  update: Uint8Array,
  createdAt: number,
): Promise<PendingUpdate> {
  return {
    messageId: globalThis.crypto.randomUUID(),
    payloadHash: await hashBytes(update),
    update,
    createdAt,
    attemptCount: 0,
  };
}

async function settlePump(state: RealtimeClientInternals): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await state.outboxPump;
}

function enableSocket(client: FabricRealtimeClient, socket: FakeSocket): void {
  const state = internals(client);
  state.capabilities = ["write"];
  state.authenticated = true;
  state.committedDocument = new Y.Doc({ gc: true });
  state.committedSequence = 0;
  state.socket = socket as unknown as WebSocket;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FabricRealtimeClient durable outbox pump", () => {
  it("treats a missing ticket route as terminal access loss without deleting the outbox", async () => {
    vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
    const outbox = new MemoryPendingUpdateOutbox();
    const pending = await pendingUpdate(createYjsUpdates(1)[0]!, 0);
    await outbox.put(scope, pending);
    const errors = vi.fn();
    const states = vi.fn();
    const fetchImplementation = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 404 }),
    );
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox,
      persistenceFactory,
      fetchImplementation,
      webSocketFactory: () => new FakeSocket() as unknown as WebSocket,
      onError: errors,
      onConnectionStateChange: states,
    });

    client.connect();
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(states).toHaveBeenLastCalledWith("permission-denied"),
    );

    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ code: "permission_denied", permanent: true }),
    );
    expect(await outbox.list(scope)).toEqual([pending]);
    await client.destroy();
  });

  it("retries ticketing when this tab still owns an existing coordinator", async () => {
    vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        ticket: "t".repeat(64),
        expiresAt: new Date(Date.now() + 45_000).toISOString(),
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["read", "write", "awareness"],
      }),
    );
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      realtimeUrl: "wss://realtime.fabric.test/realtime",
      outbox: new MemoryPendingUpdateOutbox(),
      persistenceFactory,
      fetchImplementation,
      webSocketFactory: () => new FakeSocket() as unknown as WebSocket,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const state = internals(client);
    state.state = "permission-denied";
    state.connectionOwner = true;
    state.tabCoordinator = {
      destroy: async () => undefined,
      post: vi.fn(),
    };

    client.connect();

    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledOnce());
    state.tabCoordinator = null;
    await client.destroy();
  });

  it("keeps unresolved local updates durable but blocks a resolved read-only ticket", async () => {
    const outbox = new MemoryPendingUpdateOutbox();
    const errors = vi.fn();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox,
      persistenceFactory,
      onError: errors,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const state = internals(client);
    const [unresolvedUpdate, readOnlyUpdate] = createYjsUpdates(2);

    state.capabilities = [];
    state.queueLocalUpdate(unresolvedUpdate!);
    await state.localUpdateQueue;
    expect(await outbox.list(scope)).toHaveLength(1);

    state.capabilities = ["read", "awareness"];
    state.queueLocalUpdate(readOnlyUpdate!);
    await state.localUpdateQueue;

    expect(await outbox.list(scope)).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ code: "permission_denied", permanent: true }),
    );
    await client.destroy();
  });

  it("refreshes an authenticated ticket in-band without pausing the connection", async () => {
    vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
    const expiresAt = new Date(Date.now() + 45_000).toISOString();
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        ticket: "r".repeat(64),
        expiresAt,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["read"],
      }),
    );
    const capabilities = vi.fn();
    const outbox = new MemoryPendingUpdateOutbox();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox,
      persistenceFactory,
      fetchImplementation,
      onCapabilitiesChange: capabilities,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    enableSocket(client, socket);
    const state = internals(client);
    state.state = "connected";
    state.ticket = {
      ticket: "i".repeat(64),
      expiresAt: new Date(Date.now() + 15_000).toISOString(),
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      capabilities: ["write"],
    };

    await state.requestTicketRefresh();
    const refresh = JSON.parse(socket.sent.at(-1)!) as { messageId: string };
    state.handleAuthenticationRefreshed({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type: "auth.refreshed",
      messageId: refresh.messageId,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      clientInstanceId: client.clientInstanceId,
      payload: {
        capabilities: ["read"],
        expiresAt: Date.parse(expiresAt),
      },
    });

    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "auth.refresh",
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      payload: { ticket: "r".repeat(64) },
    });
    expect(state.state).toBe("connected");
    expect(socket.closes).toHaveLength(0);
    expect(client.grantedCapabilities).toEqual(["read"]);
    expect(capabilities).toHaveBeenLastCalledWith(["read"]);
    await client.destroy();
  });

  it.each([
    { randomValue: 0, refreshLeadMs: 10_000 },
    { randomValue: 1, refreshLeadMs: 15_000 },
  ])(
    "schedules a healthy in-band refresh $refreshLeadMs ms before exact expiry",
    async ({ randomValue, refreshLeadMs }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
      vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
      const initialExpiresAt = Date.now() + 45_000;
      const refreshedExpiresAt = Date.now() + 90_000;
      const fetchImplementation = vi.fn<typeof fetch>(async () =>
        Response.json({
          protocolVersion: REALTIME_PROTOCOL_VERSION,
          ticket: "r".repeat(64),
          expiresAt: new Date(refreshedExpiresAt).toISOString(),
          boardId: BOARD_ID,
          documentGenerationId: DOCUMENT_GENERATION_ID,
          capabilities: ["write"],
        }),
      );
      const client = new FabricRealtimeClient({
        principalId: PRINCIPAL_ID,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        outbox: new MemoryPendingUpdateOutbox(),
        persistenceFactory,
        fetchImplementation,
        random: () => randomValue,
      });
      await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
      const socket = new FakeSocket();
      enableSocket(client, socket);
      const state = internals(client);
      state.state = "connected";
      const committedDocument = state.committedDocument;
      const ticket: RealtimeTicket = {
        ticket: "i".repeat(64),
        expiresAt: new Date(initialExpiresAt).toISOString(),
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["write"],
      };
      state.ticket = ticket;

      state.scheduleTicketRefresh(ticket);
      const refreshDelayMs = initialExpiresAt - Date.now() - refreshLeadMs;
      await vi.advanceTimersByTimeAsync(refreshDelayMs - 1);

      expect(fetchImplementation).not.toHaveBeenCalled();
      expect(state.state).toBe("connected");
      expect(state.socket).toBe(socket);
      expect(state.committedDocument).toBe(committedDocument);
      expect(socket.closes).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);

      expect(fetchImplementation).toHaveBeenCalledOnce();
      expect(socket.sent).toHaveLength(1);
      const refresh = JSON.parse(socket.sent[0]!) as { messageId: string };
      expect(JSON.parse(socket.sent[0]!)).toMatchObject({
        type: "auth.refresh",
        payload: { ticket: "r".repeat(64) },
      });
      expect(state.state).toBe("connected");
      expect(state.socket).toBe(socket);
      expect(state.committedDocument).toBe(committedDocument);
      expect(socket.closes).toHaveLength(0);

      state.handleAuthenticationRefreshed({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "auth.refreshed",
        messageId: refresh.messageId,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        clientInstanceId: client.clientInstanceId,
        payload: {
          capabilities: ["write"],
          expiresAt: refreshedExpiresAt,
        },
      });

      expect(state.state).toBe("connected");
      expect(state.socket).toBe(socket);
      expect(state.committedDocument).toBe(committedDocument);
      expect(socket.closes).toHaveLength(0);
      await client.destroy();
    },
  );

  it("does not restart ticketing while a bounded reconnect is already scheduled", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox: new MemoryPendingUpdateOutbox(),
      persistenceFactory,
      fetchImplementation,
    });
    const state = internals(client);
    state.state = "reconnecting";

    client.connect();
    await Promise.resolve();

    expect(fetchImplementation).not.toHaveBeenCalled();
    await client.destroy();
  });

  it("keeps a concentrated reconnect storm below the ticket-mint ceiling", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00.000Z"));
    vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
    const sockets: FakeSocket[] = [];
    const errors = vi.fn();
    expect(DEFAULT_RECONNECT_POLICY.maximumAttempts).toBe(8);
    const fetchImplementation = vi.fn<typeof fetch>(async () =>
      Response.json({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        ticket: "t".repeat(64),
        expiresAt: new Date(Date.now() + 45_000).toISOString(),
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["read", "write"],
      }),
    );
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      realtimeUrl: "wss://realtime.fabric.test/realtime",
      outbox: new MemoryPendingUpdateOutbox(),
      persistenceFactory,
      fetchImplementation,
      webSocketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      reconnect: {
        baseDelayMs: 100,
        maximumDelayMs: 100,
        jitterRatio: 0,
        maximumAttempts: DEFAULT_RECONNECT_POLICY.maximumAttempts,
      },
      onError: errors,
    });

    client.connect();
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    for (
      let attempt = 0;
      attempt < DEFAULT_RECONNECT_POLICY.maximumAttempts;
      attempt += 1
    ) {
      sockets[attempt]!.close(1006, "network_drop");
      await vi.advanceTimersByTimeAsync(100);
      await vi.waitFor(() => expect(sockets).toHaveLength(attempt + 2));
    }
    sockets.at(-1)!.close(1006, "network_drop");
    await vi.advanceTimersByTimeAsync(100);

    // One initial ticket plus the client's eight bounded reconnect attempts is
    // still below the existing per-principal/per-board issuance allowance.
    expect(fetchImplementation).toHaveBeenCalledTimes(
      DEFAULT_RECONNECT_POLICY.maximumAttempts + 1,
    );
    expect(fetchImplementation.mock.calls.length).toBeLessThan(
      REALTIME_LIMITS.ticketMintsPerMinute,
    );
    expect(sockets).toHaveLength(DEFAULT_RECONNECT_POLICY.maximumAttempts + 1);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ code: "reconnect_exhausted", permanent: true }),
    );
    await client.destroy();
  });

  it("atomically merges a rapid durable burst before sending", async () => {
    vi.useFakeTimers();
    const outbox = new MemoryPendingUpdateOutbox();
    const pendingCounts: number[] = [];
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox,
      persistenceFactory,
      onPendingAcknowledgementCountChange: (count) => pendingCounts.push(count),
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    enableSocket(client, socket);
    const state = internals(client);

    const updates = createYjsUpdates(20);
    for (const update of updates) state.queueLocalUpdate(update);
    await state.localUpdateQueue;
    expect((await outbox.list(scope)).length).toBe(20);

    await vi.advanceTimersByTimeAsync(75);
    await settlePump(state);

    const stored = await outbox.list(scope);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.attemptCount).toBe(1);
    expect(socket.sent).toHaveLength(1);
    expect(pendingCounts.at(-1)).toBe(1);

    const frame = JSON.parse(socket.sent[0]!) as {
      payload: { update: string };
    };
    const remote = new Y.Doc();
    Y.applyUpdate(
      remote,
      Uint8Array.from(atob(frame.payload.update), (value) =>
        value.charCodeAt(0),
      ),
    );
    expect(remote.getMap("records").size).toBe(20);
    remote.destroy();
    await client.destroy();
  });

  it("limits replay to eight frames and pumps the next frame after an ACK", async () => {
    vi.useFakeTimers();
    const outbox = new MemoryPendingUpdateOutbox();
    const updates = createYjsUpdates(12);
    for (let index = 0; index < updates.length; index += 1) {
      const pending = await pendingUpdate(updates[index]!, index);
      await outbox.put(scope, pending);
      await outbox.markAttempt(scope, pending.messageId, index);
    }
    const pendingCounts: number[] = [];
    const acknowledged = vi.fn();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox,
      persistenceFactory,
      onPendingAcknowledgementCountChange: (count) => pendingCounts.push(count),
      onUpdateAcknowledged: acknowledged,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    enableSocket(client, socket);
    const state = internals(client);

    await state.requestOutboxPump();
    expect(socket.sent).toHaveLength(8);
    expect(pendingCounts.at(-1)).toBe(12);

    const firstFrame = JSON.parse(socket.sent[0]!) as {
      messageId: string;
    };
    const first = (await outbox.list(scope)).find(
      (entry) => entry.messageId === firstFrame.messageId,
    );
    expect(first).toBeDefined();
    await state.handleAcknowledgement({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type: "sync.ack",
      messageId: first!.messageId,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      clientInstanceId: globalThis.crypto.randomUUID(),
      payload: {
        sequence: 1,
        duplicate: false,
        payloadHash: first!.payloadHash,
      },
    });
    await settlePump(state);

    expect(socket.sent).toHaveLength(9);
    expect(await outbox.list(scope)).toHaveLength(11);
    expect(pendingCounts.at(-1)).toBe(11);
    expect(acknowledged).toHaveBeenCalledWith(first!.messageId, 1);
    await client.destroy();
  });

  it("rebases a legacy attempted backlog before a fresh socket sends", async () => {
    vi.useFakeTimers();
    const outbox = new MemoryPendingUpdateOutbox();
    const updates = createYjsUpdates(411);
    const localDocument = new Y.Doc();
    for (const update of updates) Y.applyUpdate(localDocument, update);
    for (let index = 0; index < updates.length; index += 1) {
      const pending = await pendingUpdate(updates[index]!, index);
      await outbox.put(scope, pending);
      await outbox.markAttempt(scope, pending.messageId, index);
    }
    const pendingCounts: number[] = [];
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      document: localDocument,
      outbox,
      persistenceFactory,
      onPendingAcknowledgementCountChange: (count) => pendingCounts.push(count),
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    const state = internals(client);
    state.socket = socket as unknown as WebSocket;
    const authMessageId = globalThis.crypto.randomUUID();
    state.authMessageId = authMessageId;

    const partiallyCommittedServer = new Y.Doc();
    for (const update of updates.slice(0, 200)) {
      Y.applyUpdate(partiallyCommittedServer, update);
    }
    await state.handleAuthenticated(
      {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "auth.ok",
        messageId: authMessageId,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        clientInstanceId: globalThis.crypto.randomUUID(),
        payload: {
          capabilities: ["write"],
          sequence: 200,
          stateUpdate: bytesToBase64(
            Y.encodeStateAsUpdate(partiallyCommittedServer),
          ),
          awarenessStateUpdate: null,
          limits: {
            frameBytes: REALTIME_LIMITS.frameBytes,
            updateBytes: REALTIME_LIMITS.updateBytes,
            awarenessBytes: REALTIME_LIMITS.awarenessBytes,
          },
        },
      },
      {
        ticket: "t".repeat(64),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["write"],
      },
    );

    expect(socket.sent.length).toBeGreaterThan(0);
    expect(socket.sent.length).toBe(1);
    expect(await outbox.list(scope)).toHaveLength(socket.sent.length);
    expect(pendingCounts.at(-1)).toBe(socket.sent.length);
    for (const serialized of socket.sent) {
      const frame = JSON.parse(serialized) as { payload: { update: string } };
      Y.applyUpdate(
        partiallyCommittedServer,
        Uint8Array.from(atob(frame.payload.update), (value) =>
          value.charCodeAt(0),
        ),
      );
    }
    expect(partiallyCommittedServer.getMap("records").size).toBe(411);
    partiallyCommittedServer.destroy();
    await client.destroy();
    localDocument.destroy();
  });

  it("preserves an attempted update that exists only in the durable outbox", async () => {
    vi.useFakeTimers();
    const outbox = new MemoryPendingUpdateOutbox();
    const pending = await pendingUpdate(createYjsUpdates(1)[0]!, 0);
    await outbox.put(scope, pending);
    await outbox.markAttempt(scope, pending.messageId, 1);
    const localDocument = new Y.Doc();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      document: localDocument,
      outbox,
      persistenceFactory,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    const state = internals(client);
    state.socket = socket as unknown as WebSocket;
    const authMessageId = globalThis.crypto.randomUUID();
    state.authMessageId = authMessageId;
    const emptyServer = new Y.Doc();

    await state.handleAuthenticated(
      {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "auth.ok",
        messageId: authMessageId,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        clientInstanceId: globalThis.crypto.randomUUID(),
        payload: {
          capabilities: ["write"],
          sequence: 0,
          stateUpdate: bytesToBase64(Y.encodeStateAsUpdate(emptyServer)),
          awarenessStateUpdate: null,
          limits: {
            frameBytes: REALTIME_LIMITS.frameBytes,
            updateBytes: REALTIME_LIMITS.updateBytes,
            awarenessBytes: REALTIME_LIMITS.awarenessBytes,
          },
        },
      },
      {
        ticket: "t".repeat(64),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["write"],
      },
    );

    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]!) as {
      payload: { update: string };
    };
    Y.applyUpdate(
      emptyServer,
      Uint8Array.from(atob(frame.payload.update), (value) =>
        value.charCodeAt(0),
      ),
    );
    expect(emptyServer.getMap("records").size).toBe(1);
    expect(localDocument.getMap("records").size).toBe(1);
    expect(await outbox.list(scope)).toHaveLength(1);
    emptyServer.destroy();
    await client.destroy();
    localDocument.destroy();
  });

  it("fails closed without deleting the outbox when recovery exceeds the frame limit", async () => {
    vi.useFakeTimers();
    const outbox = new MemoryPendingUpdateOutbox();
    const pending = await pendingUpdate(createYjsUpdates(1)[0]!, 0);
    await outbox.put(scope, pending);
    await outbox.markAttempt(scope, pending.messageId, 1);
    const localDocument = new Y.Doc();
    localDocument.getText("oversized").insert(0, "x".repeat(300_000));
    const errors = vi.fn();
    const states = vi.fn();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      document: localDocument,
      outbox,
      persistenceFactory,
      onError: errors,
      onConnectionStateChange: states,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    const state = internals(client);
    state.socket = socket as unknown as WebSocket;
    const authMessageId = globalThis.crypto.randomUUID();
    state.authMessageId = authMessageId;
    const emptyServer = new Y.Doc();

    await state.handleAuthenticated(
      {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "auth.ok",
        messageId: authMessageId,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        clientInstanceId: globalThis.crypto.randomUUID(),
        payload: {
          capabilities: ["write"],
          sequence: 0,
          stateUpdate: bytesToBase64(Y.encodeStateAsUpdate(emptyServer)),
          awarenessStateUpdate: null,
          limits: {
            frameBytes: REALTIME_LIMITS.frameBytes,
            updateBytes: REALTIME_LIMITS.updateBytes,
            awarenessBytes: REALTIME_LIMITS.awarenessBytes,
          },
        },
      },
      {
        ticket: "t".repeat(64),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
        capabilities: ["write"],
      },
    );

    expect(socket.sent).toHaveLength(0);
    expect(await outbox.list(scope)).toHaveLength(1);
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ code: "payload_too_large", permanent: true }),
    );
    expect(states).toHaveBeenLastCalledWith("error");
    emptyServer.destroy();
    await client.destroy();
    localDocument.destroy();
  });

  it("reconnects when an in-flight durable update receives no ACK progress", async () => {
    vi.useFakeTimers();
    const outbox = new MemoryPendingUpdateOutbox();
    const update = await pendingUpdate(createYjsUpdates(1)[0]!, 0);
    await outbox.put(scope, update);
    await outbox.markAttempt(scope, update.messageId, 0);
    const errors = vi.fn();
    const client = new FabricRealtimeClient({
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      outbox,
      persistenceFactory,
      onError: errors,
    });
    await client.prepareLocalDocument(DOCUMENT_GENERATION_ID);
    const socket = new FakeSocket();
    enableSocket(client, socket);
    const state = internals(client);

    await state.requestOutboxPump();
    expect(socket.sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(socket.closes).toContainEqual({ code: 4000, reason: "ack_timeout" });
    expect(errors).toHaveBeenCalledWith(
      expect.objectContaining({ permanent: false, code: "protocol_error" }),
    );
    expect(await outbox.list(scope)).toHaveLength(1);
    await client.destroy();
  });
});
