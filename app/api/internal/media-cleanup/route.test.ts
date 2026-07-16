import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runMediaCleanup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/r2/cleanup-runner", () => ({ runMediaCleanup }));

import { GET } from "./route";

const secret = "a-dedicated-media-cleanup-secret-value";

describe("media cleanup route", () => {
  beforeEach(() => {
    vi.stubEnv("MEDIA_CLEANUP_SECRET", secret);
    runMediaCleanup.mockReset();
    runMediaCleanup.mockResolvedValue({
      expiredUploads: 1,
      expiredAvatarUploads: 1,
      claimedDeletions: 1,
      completedDeletions: 1,
      failedDeletions: 0,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("runs one bounded pass for the exact bearer credential", async () => {
    const response = await GET(
      new Request("https://fabric.test/api/internal/media-cleanup", {
        headers: { Authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({
      status: "ok",
      expiredUploads: 1,
      expiredAvatarUploads: 1,
      claimedDeletions: 1,
      completedDeletions: 1,
      failedDeletions: 0,
    });
    expect(runMediaCleanup).toHaveBeenCalledTimes(1);
  });

  it("fails closed without invoking storage for a bad or weak credential", async () => {
    const unauthorized = await GET(
      new Request("https://fabric.test/api/internal/media-cleanup", {
        headers: { Authorization: "Bearer wrong" },
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(runMediaCleanup).not.toHaveBeenCalled();

    vi.stubEnv("MEDIA_CLEANUP_SECRET", "short");
    const unavailable = await GET(
      new Request("https://fabric.test/api/internal/media-cleanup", {
        headers: { Authorization: "Bearer short" },
      }),
    );
    expect(unavailable.status).toBe(503);
    expect(runMediaCleanup).not.toHaveBeenCalled();
  });
});
