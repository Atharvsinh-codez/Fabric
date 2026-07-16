import { randomUUID } from "node:crypto";
import { EventEmitter, once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import type { Duplex } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";
import * as Y from "yjs";

import {
  REALTIME_CLOSE,
  REALTIME_PROTOCOL_VERSION,
} from "../lib/realtime/constants";
import type { RealtimeRuntimeEnvironment } from "../lib/realtime/env";
import {
  encodePayload,
  type RealtimeServerEnvelope,
} from "../lib/realtime/protocol";
import { mintRealtimeTicket } from "../lib/realtime/tickets";
import { REALTIME_SYNC_UPDATE_QUEUE_LIMITS } from "./rooms/room";
import {
  createFabricRealtimeRuntime,
  isFabricRealtimeUpgrade,
  type FabricRealtimePersistence,
} from "./server";

const environment: RealtimeRuntimeEnvironment = {
  databaseUrl: "postgresql://fabric-realtime.invalid/fabric",
  signingKey: "signing-key-that-is-longer-than-thirty-two-characters",
  redemptionKey: "redemption-key-that-is-longer-than-thirty-two-characters",
  issuer: "fabric-web",
  audience: "fabric-realtime",
  allowedOrigins: new Set(["http://localhost:3000"]),
};

function createPersistence(): FabricRealtimePersistence {
  return {
    assertSchemaReady: vi.fn(async () => undefined),
    cleanupExpiredEphemeralRecords: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    loadRoom: vi.fn(async () => ({ lastSequence: 0, updates: [] })),
    ping: vi.fn(async () => undefined),
    persistUpdate: vi.fn(async () => ({
      kind: "committed" as const,
      sequence: 1,
    })),
    recheckAccess: vi.fn(async () => true),
    redeemTicket: vi.fn(async () => ({ kind: "permission_denied" as const })),
  };
}

function request(
  url: string,
  origin = "http://localhost:3000",
): IncomingMessage {
  return { url, headers: { origin } } as IncomingMessage;
}

function socket() {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Duplex;
}

function waitForEnvelope(
  client: WebSocket,
  predicate: (envelope: RealtimeServerEnvelope) => boolean,
): Promise<RealtimeServerEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for a realtime server envelope."));
    }, 5_000);
    const onMessage = (data: RawData) => {
      let envelope: RealtimeServerEnvelope;
      try {
        envelope = JSON.parse(data.toString()) as RealtimeServerEnvelope;
      } catch {
        return;
      }
      if (!predicate(envelope)) return;
      cleanup();
      resolve(envelope);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("The realtime socket closed before the expected envelope."));
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("message", onMessage);
      client.off("close", onClose);
    };
    client.on("message", onMessage);
    client.once("close", onClose);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isFabricRealtimeUpgrade", () => {
  it("accepts only the exact Fabric websocket path", () => {
    expect(isFabricRealtimeUpgrade({ url: "/realtime" })).toBe(true);
    expect(
      isFabricRealtimeUpgrade({
        url: "/realtime/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
      }),
    ).toBe(true);
    expect(isFabricRealtimeUpgrade({ url: "/realtime?token=leak" })).toBe(
      false,
    );
    expect(isFabricRealtimeUpgrade({ url: "/realtime/not-a-board/not-a-generation" })).toBe(false);
    expect(isFabricRealtimeUpgrade({ url: "/realtime/" })).toBe(false);
    expect(
      isFabricRealtimeUpgrade({ url: "/_next/webpack-hmr?page=%2F" }),
    ).toBe(false);
    expect(isFabricRealtimeUpgrade({ url: undefined })).toBe(false);
  });
});

describe("createFabricRealtimeRuntime", () => {
  it("forwards non-Fabric upgrades to Next without modifying them", async () => {
    const persistence = createPersistence();
    const runtime = createFabricRealtimeRuntime({ environment, persistence });
    const emitter = new EventEmitter();
    const server = emitter as unknown as Pick<Server, "on" | "off">;
    const fallback = vi.fn();
    const upgradeRequest = request("/_next/webpack-hmr?page=%2Fapp");
    const upgradeSocket = socket();
    const head = Buffer.from("hmr");
    const detach = runtime.attach(server, fallback);

    emitter.emit("upgrade", upgradeRequest, upgradeSocket, head);

    expect(fallback).toHaveBeenCalledOnce();
    expect(fallback).toHaveBeenCalledWith(upgradeRequest, upgradeSocket, head);
    expect(upgradeSocket.write).not.toHaveBeenCalled();

    detach();
    emitter.emit("upgrade", upgradeRequest, upgradeSocket, head);
    expect(fallback).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it("consumes /realtime itself and rejects it until startup is ready", async () => {
    const persistence = createPersistence();
    const runtime = createFabricRealtimeRuntime({ environment, persistence });
    const emitter = new EventEmitter();
    const server = emitter as unknown as Pick<Server, "on" | "off">;
    const fallback = vi.fn();
    const upgradeSocket = socket();
    runtime.attach(server, fallback);

    emitter.emit(
      "upgrade",
      request("/realtime"),
      upgradeSocket,
      Buffer.alloc(0),
    );

    expect(fallback).not.toHaveBeenCalled();
    expect(upgradeSocket.write).toHaveBeenCalledWith(
      expect.stringContaining("503 Service Unavailable"),
    );
    expect(upgradeSocket.destroy).toHaveBeenCalledOnce();
    await runtime.stop();
  });

  it("checks schema once, exposes a DB readiness probe, and stops idempotently", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const persistence = createPersistence();
    const runtime = createFabricRealtimeRuntime({ environment, persistence });

    await Promise.all([runtime.start(), runtime.start()]);

    expect(persistence.assertSchemaReady).toHaveBeenCalledOnce();
    expect(runtime.metrics.isReady()).toBe(true);
    await expect(runtime.ready()).resolves.toBe(true);
    expect(persistence.ping).toHaveBeenCalledOnce();

    await Promise.all([runtime.stop(), runtime.stop()]);

    expect(runtime.metrics.isReady()).toBe(false);
    await expect(runtime.ready()).resolves.toBe(false);
    expect(persistence.close).toHaveBeenCalledOnce();
  });

  it("keeps readiness false when schema validation fails", async () => {
    const persistence = createPersistence();
    vi.mocked(persistence.assertSchemaReady).mockRejectedValueOnce(
      new Error("schema missing"),
    );
    const runtime = createFabricRealtimeRuntime({ environment, persistence });

    await expect(runtime.start()).rejects.toThrow("schema missing");
    expect(runtime.metrics.isReady()).toBe(false);
    await expect(runtime.ready()).resolves.toBe(false);
    await runtime.stop();
  });

  it("rate-limits and closes a connection whose sync queue reaches its cap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const persistence = createPersistence();
    const subject = randomUUID();
    const workspaceId = randomUUID();
    const boardId = randomUUID();
    const documentGenerationId = randomUUID();
    const clientInstanceId = randomUUID();
    const { ticket, claims } = await mintRealtimeTicket(
      {
        subject,
        workspaceId,
        boardId,
        documentGenerationId,
        capabilities: ["read", "write", "awareness"],
      },
      {
        key: environment.signingKey,
        issuer: environment.issuer,
        audience: environment.audience,
      },
    );
    vi.mocked(persistence.redeemTicket).mockResolvedValue({
      kind: "allowed",
      admission: { ...claims, role: "owner" },
    });

    let releaseFirst!: () => void;
    const firstPersistenceGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let persistenceCallCount = 0;
    let sequence = 0;
    vi.mocked(persistence.persistUpdate).mockImplementation(async () => {
      persistenceCallCount += 1;
      if (persistenceCallCount === 1) await firstPersistenceGate;
      sequence += 1;
      return { kind: "committed", sequence };
    });

    const runtime = createFabricRealtimeRuntime({ environment, persistence });
    const httpServer = createServer();
    runtime.attach(httpServer, (_request, upgradeSocket) => {
      upgradeSocket.destroy();
    });
    await runtime.start();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      httpServer.once("error", onError);
      httpServer.listen(0, "127.0.0.1", () => {
        httpServer.off("error", onError);
        resolve();
      });
    });
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("The realtime test server did not expose a TCP port.");
    }

    const client = new WebSocket(
      `ws://127.0.0.1:${address.port}/realtime`,
      { origin: "http://localhost:3000" },
    );
    await once(client, "open");
    const authenticated = waitForEnvelope(
      client,
      (envelope) => envelope.type === "auth.ok",
    );
    client.send(
      JSON.stringify({
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        type: "auth",
        messageId: randomUUID(),
        clientInstanceId,
        payload: { ticket },
      }),
    );
    await authenticated;

    const document = new Y.Doc();
    document.getText("content").insert(0, "queued update");
    const update = encodePayload(Y.encodeStateAsUpdate(document));
    document.destroy();
    const rateLimited = waitForEnvelope(
      client,
      (envelope) =>
        envelope.type === "error" &&
        envelope.payload.code === "rate_limited",
    );
    const closed = once(client, "close");

    for (
      let index = 0;
      index <= REALTIME_SYNC_UPDATE_QUEUE_LIMITS.perConnection;
      index += 1
    ) {
      client.send(
        JSON.stringify({
          protocolVersion: REALTIME_PROTOCOL_VERSION,
          type: "sync.update",
          messageId: randomUUID(),
          boardId,
          documentGenerationId,
          clientInstanceId,
          payload: { update },
        }),
      );
    }

    await expect(rateLimited).resolves.toMatchObject({
      type: "error",
      payload: { code: "rate_limited" },
    });
    const [closeCode, closeReason] = await closed;
    expect(closeCode).toBe(REALTIME_CLOSE.rateLimited.code);
    expect(closeReason.toString()).toBe(REALTIME_CLOSE.rateLimited.reason);
    expect(persistence.persistUpdate).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.waitFor(
      () =>
        expect(persistence.persistUpdate).toHaveBeenCalledTimes(
          REALTIME_SYNC_UPDATE_QUEUE_LIMITS.perConnection,
        ),
      { timeout: 5_000 },
    );

    await runtime.stop();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });
});
