import "server-only";

import { randomUUID } from "node:crypto";

import {
  mediaCleanupRepository,
  type MediaCleanupRepository,
} from "@/lib/storage/r2/cleanup-repository";
import {
  getPrivateObjectStore,
  type PrivateObjectStore,
} from "@/lib/storage/r2/private-object-store";

export const MEDIA_CLEANUP_BATCH_LIMIT = 20;
const MEDIA_CLEANUP_CONCURRENCY = 4;
const MEDIA_CLEANUP_LEASE_MS = 2 * 60 * 1_000;
const MEDIA_CLEANUP_MIN_RETRY_MS = 60 * 1_000;
const MEDIA_CLEANUP_MAX_RETRY_MS = 6 * 60 * 60 * 1_000;
const SAFE_R2_ERROR_NAMES = new Set([
  "AbortError",
  "AccessDenied",
  "CredentialsProviderError",
  "InternalError",
  "InvalidAccessKeyId",
  "NetworkingError",
  "NoSuchBucket",
  "NoSuchKey",
  "RequestTimeout",
  "ServiceUnavailable",
  "SignatureDoesNotMatch",
  "SlowDown",
  "TimeoutError",
]);

type Dependencies = Readonly<{
  repository: MediaCleanupRepository;
  objectStore: PrivateObjectStore;
  now: () => Date;
  uuid: () => string;
}>;

const defaultDependencies = (): Dependencies => ({
  repository: mediaCleanupRepository,
  objectStore: getPrivateObjectStore(),
  now: () => new Date(),
  uuid: randomUUID,
});

export function mediaCleanupRetryAt(now: Date, attempt: number): Date {
  const exponent = Math.min(Math.max(attempt - 1, 0), 9);
  const delay = Math.min(
    MEDIA_CLEANUP_MIN_RETRY_MS * 2 ** exponent,
    MEDIA_CLEANUP_MAX_RETRY_MS,
  );
  return new Date(now.getTime() + delay);
}

export function mediaCleanupErrorCode(error: unknown): string {
  if (error && typeof error === "object") {
    if ("name" in error && typeof error.name === "string" && SAFE_R2_ERROR_NAMES.has(error.name)) {
      return error.name;
    }
    if ("$metadata" in error && error.$metadata && typeof error.$metadata === "object") {
      const status =
        "httpStatusCode" in error.$metadata ? error.$metadata.httpStatusCode : undefined;
      if (typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599) {
        return `r2_http_${status}`;
      }
    }
  }
  return "r2_delete_failed";
}

export async function runMediaCleanup(
  dependencies: Dependencies = defaultDependencies(),
): Promise<Readonly<{
  expiredUploads: number;
  expiredAvatarUploads: number;
  claimedDeletions: number;
  completedDeletions: number;
  failedDeletions: number;
}>> {
  const startedAt = dependencies.now();
  const expiredUploads = await dependencies.repository.expireBoardAssetUploads({
    now: startedAt,
    limit: MEDIA_CLEANUP_BATCH_LIMIT,
  });
  const expiredAvatarUploads = await dependencies.repository.expireAvatarUploads({
    now: startedAt,
    limit: MEDIA_CLEANUP_BATCH_LIMIT,
  });
  const leaseOwner = dependencies.uuid();
  const jobs = await dependencies.repository.claimObjectDeletions({
    now: startedAt,
    limit: MEDIA_CLEANUP_BATCH_LIMIT,
    leaseOwner,
    leaseExpiresAt: new Date(startedAt.getTime() + MEDIA_CLEANUP_LEASE_MS),
  });

  let completedDeletions = 0;
  let failedDeletions = 0;
  let cursor = 0;
  const workerCount = Math.min(MEDIA_CLEANUP_CONCURRENCY, jobs.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < jobs.length) {
        const job = jobs[cursor++];
        if (!job) return;
        try {
          await dependencies.objectStore.delete({
            bucket: job.bucket,
            key: job.objectKey,
          });
          const completed = await dependencies.repository.completeObjectDeletion({
            id: job.id,
            leaseOwner,
            now: dependencies.now(),
          });
          if (completed) completedDeletions += 1;
        } catch (error) {
          failedDeletions += 1;
          const failedAt = dependencies.now();
          await dependencies.repository.retryObjectDeletion({
            id: job.id,
            leaseOwner,
            now: failedAt,
            nextAttemptAt: mediaCleanupRetryAt(failedAt, job.attempt),
            errorCode: mediaCleanupErrorCode(error),
          });
        }
      }
    }),
  );

  return {
    expiredUploads,
    expiredAvatarUploads,
    claimedDeletions: jobs.length,
    completedDeletions,
    failedDeletions,
  };
}
