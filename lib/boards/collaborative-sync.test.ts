import { describe, expect, it } from "vitest";

import {
  collaborativeSyncMessage,
  collaborativeSyncState,
} from "./collaborative-sync";

describe("collaborative whiteboard sync presentation", () => {
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
