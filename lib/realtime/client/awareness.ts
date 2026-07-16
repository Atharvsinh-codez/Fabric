import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";
import type * as Y from "yjs";
import { z } from "zod";

import { REALTIME_LIMITS } from "../constants";
import {
  PRESENCE_COLORS,
  sanitizePresenceDisplayLabel,
} from "../presence-identity";
import type { RealtimeAwarenessState } from "./types";

const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
export const localAwarenessSchema = z
  .object({
    cursor: z.object({ x: coordinate, y: coordinate }).strict().optional(),
    viewport: z
      .object({
        x: coordinate,
        y: coordinate,
        width: z.number().finite().positive().max(10_000_000),
        height: z.number().finite().positive().max(10_000_000),
      })
      .strict()
      .optional(),
    selectionIds: z.array(z.string().min(1).max(128)).max(100).optional(),
  })
  .strict();

const remoteAwarenessSchema = localAwarenessSchema
  .extend({
    principalId: z.string().uuid(),
    clientInstanceId: z.string().uuid(),
    displayLabel: z
      .string()
      .max(512)
      .optional()
      .transform((value) => sanitizePresenceDisplayLabel(value)),
    avatarColor: z.enum(PRESENCE_COLORS),
  })
  .strict();

const REMOTE_AWARENESS_ORIGIN = Object.freeze({ source: "fabric-realtime-remote-awareness" });

export class EphemeralAwareness {
  readonly awareness: Awareness;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastSentAt = 0;
  private pending = false;

  constructor(
    document: Y.Doc,
    private readonly send: (update: Uint8Array) => void,
    private readonly onChange?: (
      states: ReadonlyMap<number, RealtimeAwarenessState>,
    ) => void,
    private readonly intervalMs: number = REALTIME_LIMITS.awarenessIntervalMs,
  ) {
    this.awareness = new Awareness(document);
    this.awareness.on("update", this.handleUpdate);
  }

  setLocalState(state: RealtimeAwarenessState | null): void {
    this.awareness.setLocalState(state === null ? null : localAwarenessSchema.parse(state));
  }

  applyRemoteUpdate(update: Uint8Array): void {
    applyAwarenessUpdate(this.awareness, update, REMOTE_AWARENESS_ORIGIN);
  }

  getStates(): ReadonlyMap<number, RealtimeAwarenessState> {
    const safe = new Map<number, RealtimeAwarenessState>();
    for (const [clientId, state] of this.awareness.getStates()) {
      const remote = remoteAwarenessSchema.safeParse(state);
      if (remote.success) {
        safe.set(clientId, { ...remote.data, serverAuthoritative: true });
        continue;
      }
      const local = localAwarenessSchema.safeParse(state);
      if (local.success) safe.set(clientId, local.data);
    }
    return safe;
  }

  queueCurrentState(): void {
    if (this.awareness.getLocalState() === null) return;
    this.pending = true;
    this.flush();
  }

  destroy(sendRemoval: boolean): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (sendRemoval && this.awareness.getLocalState() !== null) {
      this.awareness.setLocalState(null);
      this.flush();
    }
    this.awareness.off("update", this.handleUpdate);
    this.awareness.destroy();
  }

  private readonly handleUpdate = (
    _changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin !== "local") {
      this.onChange?.(this.getStates());
    }
    if (origin === REMOTE_AWARENESS_ORIGIN) return;
    this.pending = true;
    const elapsed = Date.now() - this.lastSentAt;
    if (elapsed >= this.intervalMs) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.intervalMs - elapsed);
    }
  };

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return;
    this.pending = false;
    this.lastSentAt = Date.now();
    this.send(encodeAwarenessUpdate(this.awareness, [this.awareness.clientID]));
  }
}
