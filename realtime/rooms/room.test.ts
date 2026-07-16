import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_SYNC_UPDATE_QUEUE_LIMITS,
  RealtimeRoom,
} from "./room";

describe("RealtimeRoom sync-update queue", () => {
  it("runs accepted persistence operations one at a time in arrival order", async () => {
    const room = new RealtimeRoom("board", "generation");
    const started: number[] = [];
    const releases = new Map<number, () => void>();
    let active = 0;
    let maximumActive = 0;

    const enqueue = (index: number) =>
      room.enqueueSyncUpdate(
        () =>
          new Promise<void>((resolve) => {
            active += 1;
            maximumActive = Math.max(maximumActive, active);
            started.push(index);
            releases.set(index, () => {
              active -= 1;
              resolve();
            });
          }),
      );

    const first = enqueue(1);
    const second = enqueue(2);
    const third = enqueue(3);
    expect(first.accepted && second.accepted && third.accepted).toBe(true);

    await vi.waitFor(() => expect(started).toEqual([1]));
    releases.get(1)?.();
    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    releases.get(2)?.();
    await vi.waitFor(() => expect(started).toEqual([1, 2, 3]));
    releases.get(3)?.();

    if (first.accepted && second.accepted && third.accepted) {
      await Promise.all([
        first.completion,
        second.completion,
        third.completion,
      ]);
    }
    expect(maximumActive).toBe(1);
    expect(room.pendingSyncUpdates).toBe(0);
    room.destroy();
  });

  it("rejects new work once the per-room queue reaches its fixed cap", async () => {
    const room = new RealtimeRoom("board", "generation");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const completions: Promise<void>[] = [];

    for (
      let index = 0;
      index < REALTIME_SYNC_UPDATE_QUEUE_LIMITS.perRoom;
      index += 1
    ) {
      const result = room.enqueueSyncUpdate(async () => gate);
      expect(result.accepted).toBe(true);
      if (result.accepted) completions.push(result.completion);
    }

    expect(room.pendingSyncUpdates).toBe(
      REALTIME_SYNC_UPDATE_QUEUE_LIMITS.perRoom,
    );
    expect(room.enqueueSyncUpdate(async () => undefined)).toEqual({
      accepted: false,
      reason: "queue_full",
    });

    release();
    await Promise.all(completions);
    expect(room.pendingSyncUpdates).toBe(0);
    room.destroy();
  });

  it("does not accept queued persistence after the room is destroyed", () => {
    const room = new RealtimeRoom("board", "generation");
    room.destroy();

    expect(room.enqueueSyncUpdate(async () => undefined)).toEqual({
      accepted: false,
      reason: "room_destroyed",
    });
  });
});
