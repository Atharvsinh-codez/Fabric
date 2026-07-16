import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runRealtimeRevocationDispatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/realtime/revocation-dispatcher", () => ({
  runRealtimeRevocationDispatch,
}));

import { GET } from "./route";

const dispatchSecret = "dedicated-realtime-dispatch-secret-value";

describe("realtime revocation dispatch route", () => {
  beforeEach(() => {
    vi.stubEnv("FABRIC_ENV", "production");
    vi.stubEnv(
      "REALTIME_REVOCATION_ENDPOINT",
      "https://fabric-realtime.example.workers.dev/internal/revocations",
    );
    vi.stubEnv("REALTIME_COORDINATOR_SECRET", "dedicated-worker-coordinator-secret-value");
    vi.stubEnv("REALTIME_REVOCATION_DISPATCH_SECRET", dispatchSecret);
    runRealtimeRevocationDispatch.mockReset();
    runRealtimeRevocationDispatch.mockResolvedValue({
      claimedEvents: 2,
      deliveredEvents: 2,
      continuedEvents: 0,
      failedEvents: 0,
      deliveredRooms: 3,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("runs one bounded pass for the exact purpose-specific bearer credential", async () => {
    const response = await GET(
      new Request("https://fabric.test/api/internal/realtime-revocations", {
        headers: { Authorization: `Bearer ${dispatchSecret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      claimedEvents: 2,
      deliveredEvents: 2,
      continuedEvents: 0,
      failedEvents: 0,
      deliveredRooms: 3,
    });
    expect(runRealtimeRevocationDispatch).toHaveBeenCalledTimes(1);
  });

  it("fails closed before touching the outbox for bad or aliased credentials", async () => {
    const unauthorized = await GET(
      new Request("https://fabric.test/api/internal/realtime-revocations", {
        headers: { Authorization: "Bearer wrong" },
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(runRealtimeRevocationDispatch).not.toHaveBeenCalled();

    vi.stubEnv("REALTIME_COORDINATOR_SECRET", dispatchSecret);
    const unavailable = await GET(
      new Request("https://fabric.test/api/internal/realtime-revocations", {
        headers: { Authorization: `Bearer ${dispatchSecret}` },
      }),
    );
    expect(unavailable.status).toBe(503);
    expect(runRealtimeRevocationDispatch).not.toHaveBeenCalled();
  });
});
