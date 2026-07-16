import { createHash } from "node:crypto";

import type WebSocket from "ws";
import * as Y from "yjs";

import { REALTIME_LIMITS } from "../../lib/realtime/constants";
import type { LoadedRealtimeRoom } from "../persistence/postgres";
import { RealtimeRoom } from "./room";

const EMPTY_ROOM_RETENTION_MS = 60_000;

export type RealtimeRoomPersistence = Readonly<{
  loadRoom: (
    boardId: string,
    documentGenerationId: string,
  ) => Promise<LoadedRealtimeRoom>;
}>;

export class RealtimeRoomManager {
  private readonly rooms = new Map<string, RealtimeRoom>();
  private readonly loads = new Map<string, Promise<RealtimeRoom>>();
  private readonly retireTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(private readonly persistence: RealtimeRoomPersistence) {}

  get activeRoomCount(): number {
    return this.rooms.size;
  }

  get activeConnectionCount(): number {
    let count = 0;
    for (const room of this.rooms.values()) count += room.peers.size;
    return count;
  }

  async getOrCreate(
    boardId: string,
    documentGenerationId: string,
  ): Promise<RealtimeRoom> {
    const key = `${boardId}:${documentGenerationId}`;
    const existing = this.rooms.get(key);
    if (existing) return existing;
    const loading = this.loads.get(key);
    if (loading) return loading;

    const promise = this.loadRoom(boardId, documentGenerationId).finally(() => {
      this.loads.delete(key);
    });
    this.loads.set(key, promise);
    return promise;
  }

  addPeer(room: RealtimeRoom, socket: WebSocket): void {
    const timer = this.retireTimers.get(room.key);
    if (timer) clearTimeout(timer);
    this.retireTimers.delete(room.key);
    room.peers.add(socket);
  }

  removePeer(room: RealtimeRoom, socket: WebSocket): void {
    room.peers.delete(socket);
    if (this.rooms.get(room.key) !== room) return;
    if (room.peers.size !== 0 || this.retireTimers.has(room.key)) return;
    const timer = setTimeout(() => {
      this.retireTimers.delete(room.key);
      if (room.peers.size !== 0) return;
      this.rooms.delete(room.key);
      room.destroy();
    }, EMPTY_ROOM_RETENTION_MS);
    timer.unref();
    this.retireTimers.set(room.key, timer);
  }

  quarantine(room: RealtimeRoom): void {
    const timer = this.retireTimers.get(room.key);
    if (timer) clearTimeout(timer);
    this.retireTimers.delete(room.key);
    this.rooms.delete(room.key);
    room.destroy();
  }

  shutdown(): void {
    for (const timer of this.retireTimers.values()) clearTimeout(timer);
    this.retireTimers.clear();
    for (const room of this.rooms.values()) room.destroy();
    this.rooms.clear();
  }

  private async loadRoom(
    boardId: string,
    documentGenerationId: string,
  ): Promise<RealtimeRoom> {
    const stored = await this.persistence.loadRoom(
      boardId,
      documentGenerationId,
    );
    const room = new RealtimeRoom(boardId, documentGenerationId);
    try {
      for (const entry of stored.updates) {
        if (
          entry.update.byteLength === 0 ||
          entry.update.byteLength > REALTIME_LIMITS.updateBytes
        ) {
          throw new Error(
            "A persisted realtime update violates the current size limit.",
          );
        }
        const hash = createHash("sha256").update(entry.update).digest("hex");
        if (hash !== entry.payloadHash) {
          throw new Error(
            "A persisted realtime update failed its integrity check.",
          );
        }
        Y.applyUpdate(room.document, entry.update);
      }
      room.lastSequence = stored.lastSequence;
      this.rooms.set(room.key, room);
      return room;
    } catch (error) {
      room.destroy();
      throw error;
    }
  }
}
