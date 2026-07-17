import { describe, expect, it } from "vitest";

import {
  collaborativeSyncMessage,
  collaborativeSyncState,
  resolveAgentBoardReadiness,
} from "./collaborative-sync";

describe("collaborative whiteboard sync presentation", () => {
  it("marks the agent ready only after both the checkpoint and realtime ACKs settle", () => {
    expect(resolveAgentBoardReadiness("synced", "connected", 0)).toEqual({
      state: "ready",
      shouldRetryPersistence: false,
    });
    expect(resolveAgentBoardReadiness("synced", "connected", 1)).toEqual({
      state: "syncing",
      shouldRetryPersistence: false,
    });
    expect(resolveAgentBoardReadiness("synced", "authenticating", 0)).toEqual({
      state: "syncing",
      shouldRetryPersistence: false,
    });
  });

  it("uses a healthy realtime session to recover a failed authoritative checkpoint", () => {
    expect(resolveAgentBoardReadiness("error", "connected", 0)).toEqual({
      state: "needs-retry",
      shouldRetryPersistence: true,
    });
    expect(resolveAgentBoardReadiness("conflict", "connected", 0)).toEqual({
      state: "needs-retry",
      shouldRetryPersistence: true,
    });
  });

  it("never treats realtime health as a replacement for an unsettled checkpoint", () => {
    expect(resolveAgentBoardReadiness("saving", "connected", 0)).toEqual({
      state: "syncing",
      shouldRetryPersistence: false,
    });
    expect(resolveAgentBoardReadiness("offline", "reconnecting", 0)).toEqual({
      state: "needs-retry",
      shouldRetryPersistence: false,
    });
  });

  it("keeps pending writes in the compact saving state without a technical toast", () => {
    expect(collaborativeSyncState("synced", "connected", 411)).toBe("saving");
    expect(
      collaborativeSyncMessage({
        baseMessage: null,
        hydrationWarning: null,
        connectionState: "connected",
        realtimeError: null,
      }),
    ).toBeNull();
  });

  it("prioritizes a recoverable connection state over queue details", () => {
    expect(collaborativeSyncState("synced", "reconnecting", 411)).toBe("offline");
    expect(
      collaborativeSyncMessage({
        baseMessage: null,
        hydrationWarning: null,
        connectionState: "reconnecting",
        realtimeError: null,
      }),
    ).toContain("Live collaboration is offline");
  });

  it("surfaces a concrete realtime error before generic connection copy", () => {
    expect(
      collaborativeSyncMessage({
        baseMessage: null,
        hydrationWarning: null,
        connectionState: "connecting",
        realtimeError: "Realtime access was revoked.",
      }),
    ).toBe("Realtime access was revoked.");
  });
});
