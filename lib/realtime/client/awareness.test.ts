import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { EphemeralAwareness } from "./awareness";

afterEach(() => {
  vi.useRealTimers();
});

describe("EphemeralAwareness", () => {
  it("throttles local cursor frames without publishing them back to the UI", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    const document = new Y.Doc();
    const receiverDocument = new Y.Doc();
    const receiver = new Awareness(receiverDocument);
    const send = vi.fn<(update: Uint8Array) => void>();
    const onChange = vi.fn();
    const awareness = new EphemeralAwareness(document, send, onChange, 100);

    awareness.setLocalState({ cursor: { x: 0, y: 0 } });
    expect(send).toHaveBeenCalledTimes(1);

    for (let index = 1; index <= 20; index += 1) {
      awareness.setLocalState({ cursor: { x: index, y: index * 2 } });
    }

    expect(onChange).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    const latestUpdate = send.mock.calls.at(-1)?.[0];
    expect(latestUpdate).toBeDefined();
    applyAwarenessUpdate(receiver, latestUpdate!, "test");
    expect(receiver.getStates().get(document.clientID)).toEqual({
      cursor: { x: 20, y: 40 },
    });

    awareness.destroy(false);
    receiver.destroy();
    document.destroy();
    receiverDocument.destroy();
  });

  it("publishes remote presence and timeout removal snapshots to the UI", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    const document = new Y.Doc();
    const peerDocument = new Y.Doc();
    const peer = new Awareness(peerDocument);
    const send = vi.fn<(update: Uint8Array) => void>();
    const snapshots: Array<ReadonlyMap<number, unknown>> = [];
    const awareness = new EphemeralAwareness(
      document,
      send,
      (states) => snapshots.push(states),
      100,
    );

    peer.setLocalState({
      cursor: { x: 120, y: 240 },
      selectionIds: ["shape:remote"],
    });
    awareness.applyRemoteUpdate(
      encodeAwarenessUpdate(peer, [peer.clientID]),
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.get(peer.clientID)).toEqual({
      cursor: { x: 120, y: 240 },
      selectionIds: ["shape:remote"],
    });
    expect(send).not.toHaveBeenCalled();

    snapshots.length = 0;
    removeAwarenessStates(awareness.awareness, [peer.clientID], "timeout");

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.has(peer.clientID)).toBe(false);

    peer.destroy();
    peerDocument.destroy();
    awareness.destroy(false);
    document.destroy();
  });

  it("marks only server-bound identity fields as authoritative", () => {
    const document = new Y.Doc();
    const peerDocument = new Y.Doc();
    const peer = new Awareness(peerDocument);
    const awareness = new EphemeralAwareness(document, vi.fn(), undefined, 100);

    peer.setLocalState({
      cursor: { x: 12, y: 24 },
      principalId: "11111111-1111-4111-8111-111111111111",
      clientInstanceId: "22222222-2222-4222-8222-222222222222",
      displayLabel: "Ada Lovelace",
      avatarColor: "#0284c7",
    });
    awareness.applyRemoteUpdate(
      encodeAwarenessUpdate(peer, [peer.clientID]),
    );
    expect(awareness.getStates().get(peer.clientID)).toEqual({
      cursor: { x: 12, y: 24 },
      principalId: "11111111-1111-4111-8111-111111111111",
      clientInstanceId: "22222222-2222-4222-8222-222222222222",
      displayLabel: "Ada Lovelace",
      avatarColor: "#0284c7",
      serverAuthoritative: true,
    });

    peer.setLocalState({
      cursor: { x: 20, y: 40 },
      principalId: "11111111-1111-4111-8111-111111111111",
      clientInstanceId: "22222222-2222-4222-8222-222222222222",
      displayLabel: "Forged palette color",
      avatarColor: "#ffffff",
    });
    awareness.applyRemoteUpdate(
      encodeAwarenessUpdate(peer, [peer.clientID]),
    );
    expect(awareness.getStates().has(peer.clientID)).toBe(false);

    peer.destroy();
    peerDocument.destroy();
    awareness.destroy(false);
    document.destroy();
  });
});
