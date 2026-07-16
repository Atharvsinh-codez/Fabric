import { beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
const runRealtimeRevocationDispatch = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/realtime/revocation-dispatcher", () => ({
  runRealtimeRevocationDispatch,
}));

import { scheduleRealtimeRevocationDispatch } from "./schedule-revocation-dispatch";

describe("post-response realtime revocation kick", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    after.mockImplementation((operation: () => Promise<void>) => operation());
    runRealtimeRevocationDispatch.mockResolvedValue({});
  });

  it("uses the Next lifecycle and never throws into the permission response", async () => {
    expect(() => scheduleRealtimeRevocationDispatch()).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(runRealtimeRevocationDispatch).toHaveBeenCalledOnce());

    after.mockImplementation(() => {
      throw new Error("missing request lifecycle");
    });
    expect(() => scheduleRealtimeRevocationDispatch()).not.toThrow();
  });
});
