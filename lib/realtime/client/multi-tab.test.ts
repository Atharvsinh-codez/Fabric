import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { REALTIME_LIMITS, REALTIME_PROTOCOL_VERSION } from "../constants";
import { bytesToBase64 } from "./encoding";
import type { RealtimeTabChannel, RealtimeTabLockManager } from "./multi-tab";
import { MemoryPendingUpdateOutbox } from "./persistence";
import { FabricRealtimeClient } from "./realtime-client";
import type { DocumentPersistenceFactory } from "./types";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_GENERATION_ID = "33333333-3333-4333-8333-333333333333";

const persistenceFactory: DocumentPersistenceFactory = () => ({
  origin: {},
  whenSynced: Promise.resolve(),
  destroy: async () => undefined,
  clearData: async () => undefined,
});

type LockWaiter = {
  callback: () => Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
  signal: AbortSignal;
  started: boolean;
  onAbort: () => void;
};

class FakeExclusiveLockManager implements RealtimeTabLockManager {
  private active = false;
  private readonly waiters: LockWaiter[] = [];
  maximumConcurrentOwners = 0;
  requestCount = 0;

  request(
    _name: string,
    options: Readonly<{ signal: AbortSignal }>,
    callback: () => Promise<void>,
  ): Promise<void> {
    this.requestCount += 1;
    return new Promise<void>((resolve, reject) => {
      const waiter: LockWaiter = {
        callback,
        reject,
        resolve,
        signal: options.signal,
        started: false,
        onAbort: () => undefined,
      };
      waiter.onAbort = () => {
        if (waiter.started) return;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        const error = new Error("The lock request was aborted.");
        error.name = "AbortError";
        reject(error);
      };
      if (options.signal.aborted) {
        waiter.onAbort();
        return;
      }
      options.signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    if (this.active) return;
    const waiter = this.waiters.shift();
    if (!waiter) return;
    if (waiter.signal.aborted) {
      waiter.onAbort();
      this.drain();
      return;
    }
    waiter.started = true;
    this.active = true;
    this.maximumConcurrentOwners = Math.max(
      this.maximumConcurrentOwners,
      this.active ? 1 : 0,
    );
    void waiter
      .callback()
      .then(waiter.resolve, waiter.reject)
      .finally(() => {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        this.active = false;
        this.drain();
      });
  }
}

class FakeTabChannel implements RealtimeTabChannel {
  private readonly listeners = new Set<
    (event: MessageEvent<unknown>) => void
  >();
  closed = false;

  constructor(
    readonly name: string,
    private readonly hub: FakeBroadcastHub,
  ) {}

  postMessage(message: unknown): void {
    this.hub.broadcast(this, message);
  }

  close(): void {
    this.closed = true;
    this.hub.remove(this);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.add(listener);
  }

  removeEventListener(
    _type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    this.listeners.delete(listener);
  }

  deliver(message: unknown): void {
    if (this.closed) return;
    for (const listener of this.listeners) {
      listener({ data: message } as MessageEvent<unknown>);
    }
  }
}

class FakeBroadcastHub {
  private readonly channels = new Set<FakeTabChannel>();

  readonly createChannel = (name: string): RealtimeTabChannel => {
    const channel = new FakeTabChannel(name, this);
    this.channels.add(channel);
    return channel;
  };

  broadcast(sender: FakeTabChannel, message: unknown): void {
    for (const channel of this.channels) {
      if (channel === sender || channel.name !== sender.name) continue;
      queueMicrotask(() => channel.deliver(message));
    }
  }

  remove(channel: FakeTabChannel): void {
    this.channels.delete(channel);
  }
}

class FakeWebSocket {
  readyState = 0;
  binaryType: BinaryType = "blob";
  readonly sent: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  send(frame: string): void {
    this.sent.push(frame);
  }

  receive(frame: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>);
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason } as CloseEvent);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("realtime multi-tab ownership", () => {
  it("uses one socket, relays a follower update, deduplicates ACKs, and hands off the lock", async () => {
    vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
    const lockManager = new FakeExclusiveLockManager();
    const hub = new FakeBroadcastHub();
    const outbox = new MemoryPendingUpdateOutbox();
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
    const firstSockets: FakeWebSocket[] = [];
    const secondSockets: FakeWebSocket[] = [];
    const firstAcknowledged = vi.fn();
    const secondAcknowledged = vi.fn();
    const common = {
      principalId: PRINCIPAL_ID,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      realtimeUrl: "wss://realtime.fabric.test/realtime",
      outbox,
      persistenceFactory,
      fetchImplementation,
      multiTab: {
        lockManager,
        channelFactory: hub.createChannel,
      },
    } as const;
    const first = new FabricRealtimeClient({
      ...common,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        firstSockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onUpdateAcknowledged: firstAcknowledged,
    });
    const second = new FabricRealtimeClient({
      ...common,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        secondSockets.push(socket);
        return socket as unknown as WebSocket;
      },
      onUpdateAcknowledged: secondAcknowledged,
    });

    first.connect();
    second.connect();
    await vi.waitFor(() =>
      expect(firstSockets.length + secondSockets.length).toBe(1),
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(lockManager.maximumConcurrentOwners).toBe(1);

    const firstOwnsConnection = firstSockets.length === 1;
    const owner = firstOwnsConnection ? first : second;
    const follower = firstOwnsConnection ? second : first;
    const ownerSocket = (firstSockets[0] ?? secondSockets[0])!;
    const ownerAcknowledged = firstOwnsConnection
      ? firstAcknowledged
      : secondAcknowledged;
    const followerAcknowledged = firstOwnsConnection
      ? secondAcknowledged
      : firstAcknowledged;
    ownerSocket.open();
    const auth = JSON.parse(ownerSocket.sent[0]!) as { messageId: string };
    const empty = new Y.Doc();
    const emptySnapshot = bytesToBase64(Y.encodeStateAsUpdate(empty));
    empty.destroy();
    ownerSocket.receive({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type: "auth.ok",
      messageId: auth.messageId,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      clientInstanceId: owner.clientInstanceId,
      payload: {
        capabilities: ["read", "write"],
        sequence: 0,
        stateUpdate: emptySnapshot,
        awarenessStateUpdate: null,
        limits: {
          frameBytes: REALTIME_LIMITS.frameBytes,
          updateBytes: REALTIME_LIMITS.maximumUpdateBytes,
          awarenessBytes: REALTIME_LIMITS.awarenessBytes,
        },
      },
    });
    await vi.waitFor(() => expect(owner.connectionState).toBe("connected"));
    await vi.waitFor(() => expect(follower.connectionState).toBe("connected"));
    expect(follower.canWrite()).toBe(true);

    follower.document.getMap("records").set("shape:follower", {
      type: "rectangle",
    });
    await vi.waitFor(() =>
      expect(
        ownerSocket.sent.some(
          (frame) =>
            (JSON.parse(frame) as { type?: string }).type === "sync.update",
        ),
      ).toBe(true),
    );
    const sync = ownerSocket.sent
      .map((frame) => JSON.parse(frame) as Record<string, unknown>)
      .find((frame) => frame.type === "sync.update") as {
      messageId: string;
    };
    const pending = (
      await outbox.list({
        principalId: PRINCIPAL_ID,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
      })
    ).find((update) => update.messageId === sync.messageId);
    expect(pending).toBeDefined();
    ownerSocket.receive({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type: "sync.ack",
      messageId: sync.messageId,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      clientInstanceId: owner.clientInstanceId,
      payload: {
        sequence: 1,
        duplicate: false,
        payloadHash: pending!.payloadHash,
      },
    });
    await vi.waitFor(() => expect(ownerAcknowledged).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(followerAcknowledged).toHaveBeenCalledTimes(1),
    );
    await expect(
      outbox.list({
        principalId: PRINCIPAL_ID,
        boardId: BOARD_ID,
        documentGenerationId: DOCUMENT_GENERATION_ID,
      }),
    ).resolves.toHaveLength(0);

    ownerSocket.receive({
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type: "sync.ack",
      messageId: sync.messageId,
      boardId: BOARD_ID,
      documentGenerationId: DOCUMENT_GENERATION_ID,
      clientInstanceId: owner.clientInstanceId,
      payload: {
        sequence: 1,
        duplicate: true,
        payloadHash: pending!.payloadHash,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ownerAcknowledged).toHaveBeenCalledTimes(1);
    expect(followerAcknowledged).toHaveBeenCalledTimes(1);
    expect(owner.connectionState).not.toBe("error");
    expect(follower.connectionState).not.toBe("error");

    await owner.destroy();
    await vi.waitFor(() =>
      expect(firstSockets.length + secondSockets.length).toBe(2),
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(lockManager.maximumConcurrentOwners).toBe(1);
    expect(lockManager.requestCount).toBe(2);
    await follower.destroy();
  });

  it("keeps a twelve-tab ownership handoff storm within the ticket-mint ceiling", async () => {
    vi.stubGlobal("location", new URL("https://fabric.test/boards/example"));
    expect(REALTIME_LIMITS.ticketMintsPerMinute).toBe(12);
    const tabCount = 12;
    const lockManager = new FakeExclusiveLockManager();
    const hub = new FakeBroadcastHub();
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
    const socketsByTab = Array.from(
      { length: tabCount },
      () => [] as FakeWebSocket[],
    );
    const tabs = socketsByTab.map(
      (sockets) =>
        new FabricRealtimeClient({
          principalId: PRINCIPAL_ID,
          boardId: BOARD_ID,
          documentGenerationId: DOCUMENT_GENERATION_ID,
          realtimeUrl: "wss://realtime.fabric.test/realtime",
          outbox: new MemoryPendingUpdateOutbox(),
          persistenceFactory,
          fetchImplementation,
          multiTab: {
            lockManager,
            channelFactory: hub.createChannel,
          },
          webSocketFactory: () => {
            const socket = new FakeWebSocket();
            sockets.push(socket);
            return socket as unknown as WebSocket;
          },
        }),
    );
    const liveTabs = new Set(tabs);
    const socketCount = (): number =>
      socketsByTab.reduce((total, sockets) => total + sockets.length, 0);

    for (const tab of tabs) tab.connect();
    await vi.waitFor(() => expect(socketCount()).toBe(1));
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(lockManager.maximumConcurrentOwners).toBe(1);

    for (let handoff = 1; handoff < tabCount; handoff += 1) {
      const ownerIndex = socketsByTab.findIndex(
        (sockets, index) => sockets.length > 0 && liveTabs.has(tabs[index]!),
      );
      expect(ownerIndex).toBeGreaterThanOrEqual(0);
      const owner = tabs[ownerIndex]!;
      liveTabs.delete(owner);
      await owner.destroy();
      await vi.waitFor(() => expect(socketCount()).toBe(handoff + 1));
      expect(fetchImplementation).toHaveBeenCalledTimes(handoff + 1);
      expect(lockManager.maximumConcurrentOwners).toBe(1);
    }

    expect(fetchImplementation).toHaveBeenCalledTimes(tabCount);
    expect(fetchImplementation.mock.calls.length).toBeLessThanOrEqual(
      REALTIME_LIMITS.ticketMintsPerMinute,
    );
    expect(lockManager.requestCount).toBe(tabCount);
    await Promise.all([...liveTabs].map((tab) => tab.destroy()));
  });
});
