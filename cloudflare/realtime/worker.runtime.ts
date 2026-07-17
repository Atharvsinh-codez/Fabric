import { env, exports } from "cloudflare:workers";
import { reset, runInDurableObject } from "cloudflare:test";
import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import * as Y from "yjs";

import {
  REALTIME_CLOSE,
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
} from "../../lib/realtime/constants.ts";
import {
  serializeAuthFrame,
  serializeAuthRefreshFrame,
} from "../../lib/realtime/client/protocol.ts";
import { decodePayload, encodePayload } from "../../lib/realtime/protocol.ts";
import { authoritativePresenceColor } from "../../lib/realtime/presence-identity.ts";
import { mintRealtimeTicket } from "../../lib/realtime/tickets.ts";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const GENERATION_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WORKSPACE_ID = "66666666-6666-4666-8666-666666666666";
const PRINCIPAL_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PRINCIPAL_ID = "77777777-7777-4777-8777-777777777777";
const CLIENT_INSTANCE_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_CLIENT_INSTANCE_ID = "99999999-9999-4999-8999-999999999999";
const SIGNING_KEY = "fabric-realtime-worker-test-signing-key-32-bytes";
const COORDINATOR_SECRET = "fabric-realtime-coordinator-test-secret-32-bytes";

const openSockets = new Set<WebSocket>();

async function connectSocket(): Promise<WebSocket> {
  const response = await exports.default.fetch(
    new Request(`http://localhost/realtime/${BOARD_ID}/${GENERATION_ID}`, {
      headers: {
        Origin: "http://localhost:3000",
        Upgrade: "websocket",
      },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  expect(socket).not.toBeNull();
  socket!.accept();
  openSockets.add(socket!);
  return socket!;
}

function nextFrame(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent): void => {
      cleanup();
      try {
        resolve(JSON.parse(String(event.data)) as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    };
    const onClose = (event: CloseEvent): void => {
      cleanup();
      reject(
        new Error(`Socket closed before a frame arrived (${event.code}).`),
      );
    };
    const cleanup = (): void => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

function nextFrames(
  socket: WebSocket,
  count: number,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const frames: Array<Record<string, unknown>> = [];
    const onMessage = (event: MessageEvent): void => {
      try {
        frames.push(JSON.parse(String(event.data)) as Record<string, unknown>);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (frames.length === count) {
        cleanup();
        resolve(frames);
      }
    };
    const onClose = (event: CloseEvent): void => {
      cleanup();
      reject(
        new Error(
          `Socket closed after ${frames.length}/${count} frames (${event.code}).`,
        ),
      );
    };
    const cleanup = (): void => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
  });
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) => {
    socket.addEventListener("close", resolve, { once: true });
  });
}

async function mintTicket(input?: {
  capabilities?: Array<"read" | "write" | "awareness">;
  workspaceId?: string;
  principalId?: string;
  now?: Date;
  lifetimeSeconds?: number;
  displayLabel?: string;
}) {
  return mintRealtimeTicket(
    {
      subject: input?.principalId ?? PRINCIPAL_ID,
      workspaceId: input?.workspaceId ?? WORKSPACE_ID,
      boardId: BOARD_ID,
      documentGenerationId: GENERATION_ID,
      displayLabel: input?.displayLabel,
      capabilities: input?.capabilities ?? ["read", "write", "awareness"],
      now: input?.now,
      lifetimeSeconds: input?.lifetimeSeconds,
    },
    {
      key: SIGNING_KEY,
      issuer: "fabric-web",
      audience: "fabric-realtime",
    },
  );
}

async function mintLegacyTicket(input: {
  now: Date;
  principalId?: string;
}): Promise<string> {
  const issuedAt = Math.floor(input.now.getTime() / 1_000);
  return new SignJWT({
    workspaceId: WORKSPACE_ID,
    boardId: BOARD_ID,
    documentGenerationId: GENERATION_ID,
    capabilities: ["read", "write", "awareness"],
    protocolVersion: REALTIME_PROTOCOL_VERSION,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.principalId ?? PRINCIPAL_ID)
    .setIssuer("fabric-web")
    .setAudience("fabric-realtime")
    .setJti(crypto.randomUUID())
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 30)
    .sign(new TextEncoder().encode(SIGNING_KEY));
}

async function dispatchRevocation(input: {
  eventId: string;
  principalId: string | null;
  action: "revoke" | "reauthorize";
  reason:
    | "workspace.member_removed"
    | "board.member_role_changed"
    | "board.archived";
  invalidBefore: number;
  invalidBeforeMs?: number;
}): Promise<Response> {
  return exports.default.fetch(
    new Request("http://localhost/internal/revocations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${COORDINATOR_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        targets: [
          {
            ...input,
            workspaceId: WORKSPACE_ID,
            boardId: BOARD_ID,
            documentGenerationId: GENERATION_ID,
          },
        ],
      }),
    }),
  );
}

function sendSyncUpdate(
  socket: WebSocket,
  update: Uint8Array,
  clientInstanceId = CLIENT_INSTANCE_ID,
): {
  frame: Promise<Record<string, unknown>>;
  messageId: string;
} {
  const messageId = crypto.randomUUID();
  const frame = nextFrame(socket);
  socket.send(serializeSyncUpdate(messageId, update, clientInstanceId));
  return { frame, messageId };
}

function serializeSyncUpdate(
  messageId: string,
  update: Uint8Array,
  clientInstanceId = CLIENT_INSTANCE_ID,
): string {
  return JSON.stringify({
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    type: "sync.update",
    messageId,
    boardId: BOARD_ID,
    documentGenerationId: GENERATION_ID,
    clientInstanceId,
    payload: { update: encodePayload(update) },
  });
}

async function authenticate(
  socket: WebSocket,
  ticket: string,
  clientInstanceId = CLIENT_INSTANCE_ID,
): Promise<Record<string, unknown>> {
  const frame = nextFrame(socket);
  socket.send(
    serializeAuthFrame({
      messageId: crypto.randomUUID(),
      clientInstanceId,
      ticket,
    }),
  );
  return frame;
}

afterEach(async () => {
  for (const socket of openSockets) {
    try {
      socket.close(1000, "test_complete");
    } catch {
      // The server may already have completed the close handshake.
    }
  }
  openSockets.clear();
  vi.restoreAllMocks();
  await reset();
});

describe("Fabric realtime Durable Object runtime", () => {
  it("stores an exact five-second pending-auth deadline", async () => {
    await connectSocket();
    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    const attachment = await runInDurableObject(stub, (_instance, state) => {
      const [socket] = state.getWebSockets("fabric-room");
      return socket?.deserializeAttachment() as
        | { connectedAt: number; authDeadlineAt: number; phase: string }
        | undefined;
    });

    expect(attachment).toMatchObject({ phase: "pending" });
    expect(attachment!.authDeadlineAt - attachment!.connectedAt).toBe(5_000);
  });

  it("caps the socket lease at ticket expiry and refreshes it without a snapshot", async () => {
    const initial = await mintTicket({
      now: new Date(Date.now() - 10_000),
      lifetimeSeconds: 30,
    });
    const socket = await connectSocket();
    const authOk = await authenticate(socket, initial.ticket);
    expect(authOk.type).toBe("auth.ok");

    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    const initialLease = await runInDurableObject(stub, (_instance, state) => {
      const [serverSocket] = state.getWebSockets("fabric-room");
      return (
        serverSocket?.deserializeAttachment() as { leaseExpiresAt: number }
      ).leaseExpiresAt;
    });
    expect(initialLease).toBe(initial.claims.exp * 1_000);

    const refreshed = await mintTicket({ capabilities: ["read", "awareness"] });
    const refreshMessageId = crypto.randomUUID();
    const responseFrame = nextFrame(socket);
    socket.send(
      serializeAuthRefreshFrame({
        messageId: refreshMessageId,
        clientInstanceId: CLIENT_INSTANCE_ID,
        boardId: BOARD_ID,
        documentGenerationId: GENERATION_ID,
        ticket: refreshed.ticket,
      }),
    );
    const refreshAck = await responseFrame;

    expect(refreshAck).toMatchObject({
      type: "auth.refreshed",
      messageId: refreshMessageId,
      payload: {
        capabilities: ["read", "awareness"],
        expiresAt: refreshed.claims.exp * 1_000,
      },
    });
    expect(refreshAck.payload).not.toHaveProperty("stateUpdate");
    const refreshedLease = await runInDurableObject(
      stub,
      (_instance, state) => {
        const [serverSocket] = state.getWebSockets("fabric-room");
        return (
          serverSocket?.deserializeAttachment() as { leaseExpiresAt: number }
        ).leaseExpiresAt;
      },
    );
    expect(refreshedLease).toBe(refreshed.claims.exp * 1_000);
  });

  it("emits structured shadow telemetry without rejecting an authenticated update", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { ticket } = await mintTicket();
    const socket = await connectSocket();
    expect((await authenticate(socket, ticket)).type).toBe("auth.ok");
    const receiver = await connectSocket();
    expect(
      (
        await authenticate(
          receiver,
          (await mintTicket({ principalId: OTHER_PRINCIPAL_ID })).ticket,
          OTHER_CLIENT_INSTANCE_ID,
        )
      ).type,
    ).toBe("auth.ok");

    const document = new Y.Doc();
    document.getMap("records").set("shape:1", { type: "rectangle" });
    const update = Y.encodeStateAsUpdate(document);
    document.destroy();
    const messageId = crypto.randomUUID();
    const ack = nextFrame(socket);
    const remote = nextFrame(receiver);
    socket.send(
      JSON.stringify({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "sync.update",
        messageId,
        boardId: BOARD_ID,
        documentGenerationId: GENERATION_ID,
        clientInstanceId: CLIENT_INSTANCE_ID,
        payload: { update: encodePayload(update) },
      }),
    );

    expect(await ack).toMatchObject({
      type: "sync.ack",
      messageId,
      payload: { duplicate: false, sequence: 1 },
    });
    expect(await remote).toMatchObject({
      type: "sync.update",
      messageId,
      payload: { sequence: 1 },
    });
    const telemetry = log.mock.calls
      .map(([entry]) => String(entry))
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .find((entry) => entry.event === "fabric.realtime.update.shadow");
    expect(telemetry).toMatchObject({
      enforcement: "shadow",
      updateBytes: update.byteLength,
      sequence: 1,
      duplicate: false,
      rate: { messages: 1, bytes: update.byteLength },
      fanout: { delivered: 1, authenticatedConnections: 2 },
    });
    expect(telemetry).toHaveProperty("latencyMs.handler");
  });

  it("accepts a high-frequency legitimate update burst without rate-limit or error responses", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const socket = await connectSocket();
    expect((await authenticate(socket, (await mintTicket()).ticket)).type).toBe(
      "auth.ok",
    );
    const source = new Y.Doc();
    const updates: Uint8Array[] = [];
    source.on("update", (update) => updates.push(new Uint8Array(update)));
    const records = source.getMap<number>("burst");
    for (let index = 0; index < 64; index += 1) {
      records.set(`record:${index}`, index);
    }
    source.destroy();

    const responses = nextFrames(socket, updates.length);
    for (const update of updates) {
      socket.send(serializeSyncUpdate(crypto.randomUUID(), update));
    }
    const frames = await responses;
    expect(frames).toHaveLength(64);
    for (let index = 0; index < frames.length; index += 1) {
      expect(frames[index]).toMatchObject({
        type: "sync.ack",
        payload: { duplicate: false, sequence: index + 1 },
      });
    }
    expect(frames.some((frame) => frame.type === "error")).toBe(false);
  }, 20_000);

  it("fans a committed update out across a 101-collaborator room", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const collaboratorCount = 101;
    const clientInstanceIds = Array.from({ length: collaboratorCount }, () =>
      crypto.randomUUID(),
    );
    const [sockets, tickets] = await Promise.all([
      Promise.all(
        Array.from({ length: collaboratorCount }, () => connectSocket()),
      ),
      Promise.all(
        Array.from({ length: collaboratorCount }, () => mintTicket()),
      ),
    ]);
    await Promise.all(
      sockets.map(async (socket, index) => {
        expect(
          (await authenticate(socket, tickets[index].ticket, clientInstanceIds[index]))
            .type,
        ).toBe("auth.ok");
      }),
    );

    const source = new Y.Doc();
    source.getMap("records").set("shape:fanout", { type: "rectangle" });
    const update = Y.encodeStateAsUpdate(source);
    source.destroy();

    const remoteFrames = Promise.all(sockets.slice(1).map(nextFrame));
    const { frame: ack } = sendSyncUpdate(
      sockets[0],
      update,
      clientInstanceIds[0],
    );
    expect(await ack).toMatchObject({
      type: "sync.ack",
      payload: { duplicate: false, sequence: 1 },
    });
    const received = await remoteFrames;
    expect(received).toHaveLength(collaboratorCount - 1);
    expect(
      received.every(
        (frame) =>
          frame.type === "sync.update" &&
          (frame.payload as { sequence?: unknown }).sequence === 1,
      ),
    ).toBe(true);
  }, 20_000);

  it("converges two independently edited Yjs clients through committed room updates", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const firstSocket = await connectSocket();
    const secondSocket = await connectSocket();
    const firstAuthentication = await authenticate(
      firstSocket,
      (await mintTicket()).ticket,
      CLIENT_INSTANCE_ID,
    );
    const secondAuthentication = await authenticate(
      secondSocket,
      (await mintTicket({ principalId: OTHER_PRINCIPAL_ID })).ticket,
      OTHER_CLIENT_INSTANCE_ID,
    );
    expect(firstAuthentication).toMatchObject({
      type: "auth.ok",
      payload: { sequence: 0 },
    });
    expect(secondAuthentication).toMatchObject({
      type: "auth.ok",
      payload: { sequence: 0 },
    });

    const firstDocument = new Y.Doc();
    const secondDocument = new Y.Doc();
    Y.applyUpdate(
      firstDocument,
      decodePayload(
        (firstAuthentication.payload as { stateUpdate: string }).stateUpdate,
        REALTIME_LIMITS.snapshotBytes,
      ),
    );
    Y.applyUpdate(
      secondDocument,
      decodePayload(
        (secondAuthentication.payload as { stateUpdate: string }).stateUpdate,
        REALTIME_LIMITS.snapshotBytes,
      ),
    );

    const firstStateVector = Y.encodeStateVector(firstDocument);
    firstDocument.getMap<string>("records").set("shape:first", "rectangle");
    const firstUpdate = Y.encodeStateAsUpdate(firstDocument, firstStateVector);
    const firstAck = nextFrame(firstSocket);
    const firstRemote = nextFrame(secondSocket);
    const firstMessageId = crypto.randomUUID();
    firstSocket.send(
      serializeSyncUpdate(firstMessageId, firstUpdate, CLIENT_INSTANCE_ID),
    );
    expect(await firstAck).toMatchObject({
      type: "sync.ack",
      messageId: firstMessageId,
      payload: { sequence: 1, duplicate: false },
    });
    const firstRemoteFrame = await firstRemote;
    expect(firstRemoteFrame).toMatchObject({
      type: "sync.update",
      messageId: firstMessageId,
      clientInstanceId: CLIENT_INSTANCE_ID,
      payload: { sequence: 1 },
    });
    Y.applyUpdate(
      secondDocument,
      decodePayload(
        (firstRemoteFrame.payload as { update: string }).update,
        REALTIME_LIMITS.maximumUpdateBytes,
      ),
    );

    const secondStateVector = Y.encodeStateVector(secondDocument);
    secondDocument.getMap<string>("records").set("shape:second", "ellipse");
    const secondUpdate = Y.encodeStateAsUpdate(secondDocument, secondStateVector);
    const secondAck = nextFrame(secondSocket);
    const secondRemote = nextFrame(firstSocket);
    const secondMessageId = crypto.randomUUID();
    secondSocket.send(
      serializeSyncUpdate(
        secondMessageId,
        secondUpdate,
        OTHER_CLIENT_INSTANCE_ID,
      ),
    );
    expect(await secondAck).toMatchObject({
      type: "sync.ack",
      messageId: secondMessageId,
      payload: { sequence: 2, duplicate: false },
    });
    const secondRemoteFrame = await secondRemote;
    expect(secondRemoteFrame).toMatchObject({
      type: "sync.update",
      messageId: secondMessageId,
      clientInstanceId: OTHER_CLIENT_INSTANCE_ID,
      payload: { sequence: 2 },
    });
    Y.applyUpdate(
      firstDocument,
      decodePayload(
        (secondRemoteFrame.payload as { update: string }).update,
        REALTIME_LIMITS.maximumUpdateBytes,
      ),
    );

    expect([...firstDocument.getMap("records").entries()]).toEqual([
      ...secondDocument.getMap("records").entries(),
    ]);
    expect(Y.encodeStateVector(firstDocument)).toEqual(
      Y.encodeStateVector(secondDocument),
    );
    firstDocument.destroy();
    secondDocument.destroy();
  });

  it("reloads committed state for a hibernated socket after in-memory eviction", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const socket = await connectSocket();
    expect(await authenticate(socket, (await mintTicket()).ticket)).toMatchObject({
      type: "auth.ok",
      payload: { sequence: 0 },
    });

    const source = new Y.Doc();
    const records = source.getMap<string>("records");
    records.set("shape:before-eviction", "rectangle");
    expect(await sendSyncUpdate(socket, Y.encodeStateAsUpdate(source)).frame).toMatchObject({
      type: "sync.ack",
      payload: { sequence: 1 },
    });

    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    const attachment = await runInDurableObject(stub, (instance, state) => {
      (
        instance as unknown as { resetLoadedDocument: () => void }
      ).resetLoadedDocument();
      const [serverSocket] = state.getWebSockets("fabric-room");
      return serverSocket?.deserializeAttachment() as
        | { phase: string; clientInstanceId: string }
        | undefined;
    });
    expect(attachment).toMatchObject({
      phase: "authenticated",
      clientInstanceId: CLIENT_INSTANCE_ID,
    });

    const beforeSecondUpdate = Y.encodeStateVector(source);
    records.set("shape:after-eviction", "ellipse");
    expect(
      await sendSyncUpdate(
        socket,
        Y.encodeStateAsUpdate(source, beforeSecondUpdate),
      ).frame,
    ).toMatchObject({
      type: "sync.ack",
      payload: { sequence: 2 },
    });

    const recoverySocket = await connectSocket();
    const recovery = await authenticate(
      recoverySocket,
      (await mintTicket({ principalId: OTHER_PRINCIPAL_ID })).ticket,
      OTHER_CLIENT_INSTANCE_ID,
    );
    expect(recovery).toMatchObject({
      type: "auth.ok",
      payload: { sequence: 2 },
    });
    const restored = new Y.Doc();
    Y.applyUpdate(
      restored,
      decodePayload(
        (recovery.payload as { stateUpdate: string }).stateUpdate,
        REALTIME_LIMITS.snapshotBytes,
      ),
    );
    expect([...restored.getMap("records").entries()]).toEqual([
      ["shape:before-eviction", "rectangle"],
      ["shape:after-eviction", "ellipse"],
    ]);
    source.destroy();
    restored.destroy();
  });

  it("denies a viewer write without committing or broadcasting the update", async () => {
    const socket = await connectSocket();
    expect(
      await authenticate(
        socket,
        (await mintTicket({ capabilities: ["read", "awareness"] })).ticket,
      ),
    ).toMatchObject({
      type: "auth.ok",
      payload: { capabilities: ["read", "awareness"], sequence: 0 },
    });

    const source = new Y.Doc();
    source.getMap("records").set("shape:forbidden", "rectangle");
    const close = nextClose(socket);
    const denied = sendSyncUpdate(socket, Y.encodeStateAsUpdate(source));
    expect(await denied.frame).toMatchObject({
      type: "error",
      messageId: denied.messageId,
      payload: { code: "permission_denied" },
    });
    expect((await close).code).toBe(REALTIME_CLOSE.permissionDenied.code);

    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    const persisted = await runInDurableObject(stub, (_instance, state) => ({
      sequence:
        state.storage.sql
          .exec<{ last_sequence: number }>(
            "select last_sequence from room_meta where singleton = 1",
          )
          .toArray()[0]?.last_sequence ?? 0,
      updates: state.storage.sql
        .exec<{ count: number }>("select count(*) as count from room_updates")
        .toArray()[0]?.count,
    }));
    expect(persisted).toEqual({ sequence: 0, updates: 0 });
    source.destroy();
  });

  it("supports one hundred authenticated sockets in a room", async () => {
    const frames = await Promise.all(
      Array.from({ length: 100 }, async () => {
        const socket = await connectSocket();
        const { ticket } = await mintTicket();
        return authenticate(socket, ticket);
      }),
    );
    expect(frames).toHaveLength(100);
    expect(frames.every((frame) => frame.type === "auth.ok")).toBe(true);

    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    const authenticatedCount = await runInDurableObject(
      stub,
      (_instance, state) =>
        state
          .getWebSockets("fabric-room")
          .filter(
            (socket) =>
              (socket.deserializeAttachment() as { phase?: string } | null)
                ?.phase === "authenticated",
          ).length,
    );
    expect(authenticatedCount).toBe(100);
  }, 20_000);

  it("broadcasts only the identity bound by the signed ticket", async () => {
    const senderSocket = await connectSocket();
    const receiverSocket = await connectSocket();
    expect(
      await authenticate(
        senderSocket,
        (await mintTicket({ displayLabel: "Ada Lovelace" })).ticket,
      ),
    ).toMatchObject({ type: "auth.ok" });
    expect(
      await authenticate(
        receiverSocket,
        (
          await mintTicket({
            principalId: OTHER_PRINCIPAL_ID,
            displayLabel: "Grace Hopper",
          })
        ).ticket,
      ),
    ).toMatchObject({ type: "auth.ok" });

    const senderDocument = new Y.Doc();
    const senderAwareness = new Awareness(senderDocument);
    senderAwareness.setLocalState({ cursor: { x: 12, y: 24 } });
    const messageId = crypto.randomUUID();
    const broadcast = nextFrame(receiverSocket);
    senderSocket.send(
      JSON.stringify({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "awareness.update",
        messageId,
        boardId: BOARD_ID,
        documentGenerationId: GENERATION_ID,
        clientInstanceId: CLIENT_INSTANCE_ID,
        payload: {
          update: encodePayload(
            encodeAwarenessUpdate(senderAwareness, [senderAwareness.clientID]),
          ),
        },
      }),
    );

    const frame = await broadcast;
    expect(frame).toMatchObject({ type: "awareness.update", messageId });
    const receiverDocument = new Y.Doc();
    const receiverAwareness = new Awareness(receiverDocument);
    applyAwarenessUpdate(
      receiverAwareness,
      decodePayload(
        (frame.payload as { update: string }).update,
        REALTIME_LIMITS.awarenessBytes,
      ),
      "test",
    );
    expect(receiverAwareness.getStates().get(senderAwareness.clientID)).toEqual({
      cursor: { x: 12, y: 24 },
      principalId: PRINCIPAL_ID,
      clientInstanceId: CLIENT_INSTANCE_ID,
      displayLabel: "Ada Lovelace",
      avatarColor: authoritativePresenceColor(PRINCIPAL_ID),
    });

    senderAwareness.destroy();
    senderDocument.destroy();
    receiverAwareness.destroy();
    receiverDocument.destroy();
  });

  it("backfills a legacy room workspace once and preserves the binding", async () => {
    const socket = await connectSocket();
    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec(
        `insert into room_meta (
           singleton, workspace_id, board_id, document_generation_id,
           last_sequence, snapshot_sequence, snapshot_chunks
         ) values (1, null, ?, ?, 0, 0, 0)`,
        BOARD_ID,
        GENERATION_ID,
      );
    });

    expect((await authenticate(socket, (await mintTicket()).ticket)).type).toBe(
      "auth.ok",
    );
    const workspaceId = await runInDurableObject(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ workspace_id: string }>(
            "select workspace_id from room_meta where singleton = 1",
          )
          .toArray()[0]?.workspace_id,
    );
    expect(workspaceId).toBe(WORKSPACE_ID);
  });

  it("rejects a different workspace after reloading an immutable room scope", async () => {
    const firstSocket = await connectSocket();
    expect(
      (await authenticate(firstSocket, (await mintTicket()).ticket)).type,
    ).toBe("auth.ok");
    const document = new Y.Doc();
    document.getMap("records").set("shape:scope", "workspace-bound");
    const update = Y.encodeStateAsUpdate(document);
    document.destroy();
    expect((await sendSyncUpdate(firstSocket, update).frame).type).toBe(
      "sync.ack",
    );

    const stub = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    await runInDurableObject(stub, (instance) => {
      const loaded = instance as unknown as { document: Y.Doc | null };
      loaded.document?.destroy();
      loaded.document = null;
    });

    const secondSocket = await connectSocket();
    const close = nextClose(secondSocket);
    secondSocket.send(
      serializeAuthFrame({
        messageId: crypto.randomUUID(),
        clientInstanceId: CLIENT_INSTANCE_ID,
        ticket: (await mintTicket({ workspaceId: OTHER_WORKSPACE_ID })).ticket,
      }),
    );
    expect((await close).code).toBe(REALTIME_CLOSE.permissionDenied.code);
    const workspaceId = await runInDurableObject(
      stub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ workspace_id: string }>(
            "select workspace_id from room_meta where singleton = 1",
          )
          .toArray()[0]?.workspace_id,
    );
    expect(workspaceId).toBe(WORKSPACE_ID);
  });

  it("rejects an update whose resulting candidate snapshot exceeds the bound", async () => {
    const socket = await connectSocket();
    expect((await authenticate(socket, (await mintTicket()).ticket)).type).toBe(
      "auth.ok",
    );

    const source = new Y.Doc();
    const text = source.getText("large");
    text.insert(0, "a".repeat(2_150_000));
    const firstUpdate = Y.encodeStateAsUpdate(source);
    const stateVector = Y.encodeStateVector(source);
    text.insert(text.length, "b".repeat(2_150_000));
    const oversizedResultUpdate = Y.encodeStateAsUpdate(source, stateVector);
    source.destroy();
    expect(firstUpdate.byteLength).toBeLessThan(
      REALTIME_LIMITS.maximumUpdateBytes,
    );
    expect(oversizedResultUpdate.byteLength).toBeLessThan(
      REALTIME_LIMITS.maximumUpdateBytes,
    );

    expect(await sendSyncUpdate(socket, firstUpdate).frame).toMatchObject({
      type: "sync.ack",
      payload: { sequence: 1 },
    });
    expect(
      await sendSyncUpdate(socket, oversizedResultUpdate).frame,
    ).toMatchObject({
      type: "error",
      payload: { code: "invalid_update" },
    });

    const recoverySocket = await connectSocket();
    const recovery = await authenticate(
      recoverySocket,
      (await mintTicket()).ticket,
    );
    expect(recovery).toMatchObject({
      type: "auth.ok",
      payload: { sequence: 1 },
    });
    const payload = recovery.payload as { stateUpdate: string };
    const restored = new Y.Doc();
    Y.applyUpdate(
      restored,
      decodePayload(payload.stateUpdate, REALTIME_LIMITS.snapshotBytes),
    );
    expect(restored.getText("large").toString()).toBe("a".repeat(2_150_000));
    restored.destroy();
  });

  it("revokes only the targeted principal and persists an idempotent ticket fence", async () => {
    const first = await connectSocket();
    const second = await connectSocket();
    expect((await authenticate(first, (await mintTicket()).ticket)).type).toBe("auth.ok");
    expect(
      (
        await authenticate(
          second,
          (await mintTicket({ principalId: OTHER_PRINCIPAL_ID })).ticket,
        )
      ).type,
    ).toBe("auth.ok");

    const invalidBefore = Math.floor(Date.now() / 1_000);
    const eventId = "88888888-8888-4888-8888-888888888888";
    const close = nextClose(first);
    const response = await dispatchRevocation({
      eventId,
      principalId: PRINCIPAL_ID,
      action: "revoke",
      reason: "workspace.member_removed",
      invalidBefore,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      deliveredRooms: 1,
      duplicateRooms: 0,
      closedSockets: 1,
    });
    expect((await close).code).toBe(REALTIME_CLOSE.permissionDenied.code);

    const duplicate = await dispatchRevocation({
      eventId,
      principalId: PRINCIPAL_ID,
      action: "revoke",
      reason: "workspace.member_removed",
      invalidBefore,
    });
    expect(await duplicate.json()).toMatchObject({
      deliveredRooms: 1,
      duplicateRooms: 1,
      closedSockets: 0,
    });

    const staleTicket = await mintTicket({
      now: new Date((invalidBefore - 1) * 1_000),
      lifetimeSeconds: 30,
    });
    const reconnect = await connectSocket();
    const reconnectClose = nextClose(reconnect);
    reconnect.send(
      serializeAuthFrame({
        messageId: crypto.randomUUID(),
        clientInstanceId: CLIENT_INSTANCE_ID,
        ticket: staleTicket.ticket,
      }),
    );
    expect((await reconnectClose).code).toBe(REALTIME_CLOSE.permissionDenied.code);

    const pong = nextFrame(second);
    second.send(
      JSON.stringify({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "ping",
        messageId: crypto.randomUUID(),
        boardId: BOARD_ID,
        documentGenerationId: GENERATION_ID,
        clientInstanceId: CLIENT_INSTANCE_ID,
        payload: { nonce: "still-connected" },
      }),
    );
    expect(await pong).toMatchObject({ type: "pong" });
  });

  it("rejects pre-event tickets but accepts a new ticket later in the same second", async () => {
    const secondStart = Math.floor((Date.now() - 2_000) / 1_000) * 1_000;
    const preEventIssuedAt = new Date(secondStart + 100);
    const invalidBeforeMs = secondStart + 500;
    const postEventIssuedAt = new Date(secondStart + 900);

    const active = await connectSocket();
    expect(
      await authenticate(
        active,
        (await mintTicket({ now: preEventIssuedAt, lifetimeSeconds: 30 })).ticket,
      ),
    ).toMatchObject({ type: "auth.ok" });

    const activeClose = nextClose(active);
    const response = await dispatchRevocation({
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      principalId: PRINCIPAL_ID,
      action: "reauthorize",
      reason: "board.member_role_changed",
      invalidBefore: Math.floor(invalidBeforeMs / 1_000),
      invalidBeforeMs,
    });
    expect(response.status).toBe(200);
    expect((await activeClose).code).toBe(1012);

    const room = env.FABRIC_BOARD_ROOMS.getByName(
      `${BOARD_ID}:${GENERATION_ID}`,
    );
    const persistedCutoffs = await runInDurableObject(room, (_instance, state) => ({
      fence: state.storage.sql
        .exec<{ invalid_before: number }>(
          "select invalid_before from revocation_fences where principal_key = ?",
          PRINCIPAL_ID,
        )
        .toArray()[0]?.invalid_before,
      receipt: state.storage.sql
        .exec<{ invalid_before: number }>(
          "select invalid_before from revocation_receipts where event_id = ?",
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        )
        .toArray()[0]?.invalid_before,
    }));
    expect(persistedCutoffs).toEqual({
      fence: Math.floor(invalidBeforeMs / 1_000),
      receipt: invalidBeforeMs,
    });

    const stale = await connectSocket();
    const staleClose = nextClose(stale);
    stale.send(
      serializeAuthFrame({
        messageId: crypto.randomUUID(),
        clientInstanceId: CLIENT_INSTANCE_ID,
        ticket: (
          await mintTicket({ now: preEventIssuedAt, lifetimeSeconds: 30 })
        ).ticket,
      }),
    );
    expect((await staleClose).code).toBe(REALTIME_CLOSE.permissionDenied.code);

    const refreshed = await connectSocket();
    expect(
      await authenticate(
        refreshed,
        (await mintTicket({ now: postEventIssuedAt, lifetimeSeconds: 30 })).ticket,
      ),
    ).toMatchObject({ type: "auth.ok" });

    const legacy = await connectSocket();
    const legacyClose = nextClose(legacy);
    legacy.send(
      serializeAuthFrame({
        messageId: crypto.randomUUID(),
        clientInstanceId: CLIENT_INSTANCE_ID,
        ticket: await mintLegacyTicket({ now: postEventIssuedAt }),
      }),
    );
    // Legacy tickets cannot prove their order within a second, so the Worker
    // preserves the old conservative rejection behavior.
    expect((await legacyClose).code).toBe(REALTIME_CLOSE.permissionDenied.code);

    const refreshedClose = nextClose(refreshed);
    const legacyRevocation = await dispatchRevocation({
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      principalId: PRINCIPAL_ID,
      action: "reauthorize",
      reason: "board.member_role_changed",
      invalidBefore: Math.floor(invalidBeforeMs / 1_000),
    });
    expect(legacyRevocation.status).toBe(200);
    expect((await refreshedClose).code).toBe(1012);

    const afterLegacyFence = await connectSocket();
    const afterLegacyFenceClose = nextClose(afterLegacyFence);
    afterLegacyFence.send(
      serializeAuthFrame({
        messageId: crypto.randomUUID(),
        clientInstanceId: CLIENT_INSTANCE_ID,
        ticket: (
          await mintTicket({
            now: new Date(secondStart + 950),
            lifetimeSeconds: 30,
          })
        ).ticket,
      }),
    );
    // A later legacy receipt invalidates the precision proof. Falling back to
    // the inclusive-second fence is conservative during mixed-version rollout.
    expect((await afterLegacyFenceClose).code).toBe(
      REALTIME_CLOSE.permissionDenied.code,
    );
  });

  it("uses a retryable close for a role/access recheck and rejects bad coordinator auth", async () => {
    const socket = await connectSocket();
    expect(await authenticate(socket, (await mintTicket()).ticket)).toMatchObject({
      type: "auth.ok",
    });
    const close = nextClose(socket);
    const response = await dispatchRevocation({
      eventId: "99999999-9999-4999-8999-999999999999",
      principalId: PRINCIPAL_ID,
      action: "reauthorize",
      reason: "board.member_role_changed",
      invalidBefore: Math.floor(Date.now() / 1_000),
    });
    expect(response.status).toBe(200);
    expect((await close).code).toBe(1012);

    const unauthorized = await exports.default.fetch(
      new Request("http://localhost/internal/revocations", {
        method: "POST",
        headers: {
          Authorization: "Bearer wrong",
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    expect(unauthorized.status).toBe(401);
  });
});
