import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./cleanup-repository", () => ({ mediaCleanupRepository: {} }));

import type { MediaCleanupRepository } from "./cleanup-repository";
import {
  MEDIA_CLEANUP_BATCH_LIMIT,
  mediaCleanupErrorCode,
  mediaCleanupRetryAt,
  runMediaCleanup,
} from "./cleanup-runner";
import type { PrivateObjectStore } from "./private-object-store";

const now = new Date("2026-07-15T10:00:00.000Z");

describe("runMediaCleanup", () => {
  it("expires, leases, deletes, completes, and safely retries a bounded batch", async () => {
    const repository = {
      expireBoardAssetUploads: vi.fn(async () => 2),
      expireAvatarUploads: vi.fn(async () => 1),
      claimObjectDeletions: vi.fn(async () => [
        { id: "one", bucket: "board-assets" as const, objectKey: "boards/one", attempt: 1 },
        { id: "two", bucket: "avatars" as const, objectKey: "avatars/two", attempt: 3 },
      ]),
      completeObjectDeletion: vi.fn(async () => true),
      retryObjectDeletion: vi.fn(async () => true),
    } satisfies MediaCleanupRepository;
    const objectStore = {
      delete: vi.fn(async ({ key }: { key: string }) => {
        if (key === "avatars/two") {
          const error = new Error("a message that must never be persisted");
          error.name = "AccessDenied";
          throw error;
        }
      }),
    } as unknown as PrivateObjectStore;

    await expect(
      runMediaCleanup({
        repository,
        objectStore,
        now: () => now,
        uuid: () => "cleanup-lease",
      }),
    ).resolves.toEqual({
      expiredUploads: 2,
      expiredAvatarUploads: 1,
      claimedDeletions: 2,
      completedDeletions: 1,
      failedDeletions: 1,
    });
    expect(repository.expireBoardAssetUploads).toHaveBeenCalledWith({
      now,
      limit: MEDIA_CLEANUP_BATCH_LIMIT,
    });
    expect(repository.expireAvatarUploads).toHaveBeenCalledWith({
      now,
      limit: MEDIA_CLEANUP_BATCH_LIMIT,
    });
    expect(repository.claimObjectDeletions).toHaveBeenCalledWith(expect.objectContaining({
      limit: MEDIA_CLEANUP_BATCH_LIMIT,
      leaseOwner: "cleanup-lease",
    }));
    expect(repository.completeObjectDeletion).toHaveBeenCalledWith(expect.objectContaining({
      id: "one",
      leaseOwner: "cleanup-lease",
    }));
    expect(repository.retryObjectDeletion).toHaveBeenCalledWith({
      id: "two",
      leaseOwner: "cleanup-lease",
      now,
      nextAttemptAt: mediaCleanupRetryAt(now, 3),
      errorCode: "AccessDenied",
    });
  });

  it("stores only allowlisted error categories and caps retry delay", () => {
    const secretBearingError = new Error("do not persist this");
    secretBearingError.name = "customer-secret-value";
    expect(mediaCleanupErrorCode(secretBearingError)).toBe("r2_delete_failed");
    expect(mediaCleanupErrorCode({ $metadata: { httpStatusCode: 503 } })).toBe("r2_http_503");
    expect(mediaCleanupRetryAt(now, 100).getTime() - now.getTime()).toBe(6 * 60 * 60 * 1_000);
  });
});
