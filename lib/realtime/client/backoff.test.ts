import { describe, expect, it } from "vitest";

import {
  DEFAULT_RECONNECT_POLICY,
  reconnectDelayMs,
  shouldRefreshLeaseAfterClose,
  shouldStopAfterClose,
} from "./backoff";

describe("realtime reconnect policy", () => {
  it("caps exponential backoff and bounded jitter", () => {
    expect(reconnectDelayMs(0, DEFAULT_RECONNECT_POLICY, () => 0)).toBe(400);
    expect(reconnectDelayMs(20, DEFAULT_RECONNECT_POLICY, () => 1)).toBe(18_000);
    expect(reconnectDelayMs(20, DEFAULT_RECONNECT_POLICY, () => 0)).toBe(12_000);
  });

  it("stops retrying permanent security and permission close codes", () => {
    expect(shouldStopAfterClose(4403)).toBe(true);
    expect(shouldStopAfterClose(4409)).toBe(true);
    expect(shouldStopAfterClose(4450)).toBe(false);
    expect(shouldStopAfterClose(4401)).toBe(false);
  });

  it("refreshes an intentional connection lease without showing an outage", () => {
    expect(
      shouldRefreshLeaseAfterClose(1012, "connection_lease_expired"),
    ).toBe(true);
    expect(shouldRefreshLeaseAfterClose(1012, "access_scope_changed")).toBe(true);
    expect(shouldRefreshLeaseAfterClose(1012, "service_restart")).toBe(false);
    expect(
      shouldRefreshLeaseAfterClose(4450, "connection_lease_expired"),
    ).toBe(false);
  });
});
