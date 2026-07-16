import type WebSocket from "ws";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

export const REALTIME_SYNC_UPDATE_QUEUE_LIMITS = {
  perConnection: 32,
  perRoom: 128,
} as const;

export type RealtimeRoomEnqueueResult<T> =
  | { accepted: true; completion: Promise<T> }
  | { accepted: false; reason: "queue_full" | "room_destroyed" };

export class RealtimeRoom {
  readonly document = new Y.Doc({ gc: true });
  readonly awareness = new Awareness(this.document);
  readonly peers = new Set<WebSocket>();
  lastSequence = 0;
  private operationQueue: Promise<void> = Promise.resolve();
  private pendingSyncUpdateCount = 0;
  private destroyed = false;

  constructor(
    readonly boardId: string,
    readonly documentGenerationId: string,
  ) {
    this.awareness.setLocalState(null);
  }

  get key(): string {
    return `${this.boardId}:${this.documentGenerationId}`;
  }

  get pendingSyncUpdates(): number {
    return this.pendingSyncUpdateCount;
  }

  enqueueSyncUpdate<T>(
    operation: () => Promise<T>,
  ): RealtimeRoomEnqueueResult<T> {
    if (this.destroyed) {
      return { accepted: false, reason: "room_destroyed" };
    }
    if (
      this.pendingSyncUpdateCount >=
      REALTIME_SYNC_UPDATE_QUEUE_LIMITS.perRoom
    ) {
      return { accepted: false, reason: "queue_full" };
    }

    this.pendingSyncUpdateCount += 1;
    const run = () => {
      if (this.destroyed) {
        throw new Error("The realtime room is no longer available.");
      }
      return operation();
    };
    const result = this.operationQueue.then(run, run);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    const completion = result.finally(() => {
      this.pendingSyncUpdateCount = Math.max(
        0,
        this.pendingSyncUpdateCount - 1,
      );
    });
    return { accepted: true, completion };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.peers.clear();
    this.awareness.destroy();
    this.document.destroy();
  }
}
