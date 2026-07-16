import "server-only";

import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import {
  assetObjectDeletions,
  avatarUploadReservations,
  boardAssets,
  boardAssetUploads,
} from "@/db/schema/assets";
import { users } from "@/db/schema/auth";
import {
  avatarFinalObjectKey,
  boardAssetFinalObjectKey,
} from "@/lib/storage/r2/object-keys";
import type { R2Bucket } from "@/lib/storage/r2/private-object-store";

export const MEDIA_CLEANUP_MAX_ATTEMPTS = 100;

export type ClaimedObjectDeletion = Readonly<{
  id: string;
  bucket: R2Bucket;
  objectKey: string;
  attempt: number;
}>;

export interface MediaCleanupRepository {
  expireBoardAssetUploads(input: { now: Date; limit: number }): Promise<number>;
  expireAvatarUploads(input: { now: Date; limit: number }): Promise<number>;
  claimObjectDeletions(input: {
    now: Date;
    limit: number;
    leaseOwner: string;
    leaseExpiresAt: Date;
  }): Promise<ClaimedObjectDeletion[]>;
  completeObjectDeletion(input: {
    id: string;
    leaseOwner: string;
    now: Date;
  }): Promise<boolean>;
  retryObjectDeletion(input: {
    id: string;
    leaseOwner: string;
    now: Date;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<boolean>;
}

export const mediaCleanupRepository: MediaCleanupRepository = {
  async expireBoardAssetUploads(input) {
    return db.transaction(async (transaction) => {
      const expired = await transaction
        .select({
          id: boardAssetUploads.id,
          boardId: boardAssetUploads.boardId,
          storageId: boardAssetUploads.storageId,
          contentHash: boardAssetUploads.contentHash,
          objectKey: boardAssetUploads.r2ObjectKey,
        })
        .from(boardAssetUploads)
        .where(
          and(
            eq(boardAssetUploads.status, "pending"),
            lte(boardAssetUploads.expiresAt, input.now),
          ),
        )
        .orderBy(asc(boardAssetUploads.expiresAt), asc(boardAssetUploads.id))
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (expired.length === 0) return 0;

      const ids = expired.map((upload) => upload.id);
      const referencedObjects = await transaction
        .select({ objectKey: boardAssets.r2ObjectKey })
        .from(boardAssets)
        .where(
          inArray(
            boardAssets.id,
            expired.map((upload) => upload.storageId),
          ),
        );
      const referencedKeys = new Set(
        referencedObjects.flatMap((asset) =>
          asset.objectKey ? [asset.objectKey] : [],
        ),
      );
      await transaction
        .insert(assetObjectDeletions)
        .values(
          expired.map((upload) => ({
            bucket: "board-assets" as const,
            objectKey: upload.objectKey,
            reason: "upload_expired",
            nextAttemptAt: input.now,
          })),
        )
        .onConflictDoNothing();
      const orphanedPromotions = expired
        .map((upload) =>
          boardAssetFinalObjectKey(
            upload.boardId,
            upload.storageId,
            upload.contentHash,
          ),
        )
        .filter((objectKey) => !referencedKeys.has(objectKey));
      if (orphanedPromotions.length > 0) {
        await transaction
          .insert(assetObjectDeletions)
          .values(
            orphanedPromotions.map((objectKey) => ({
              bucket: "board-assets" as const,
              objectKey,
              reason: "upload_orphaned_promotion",
              nextAttemptAt: input.now,
            })),
          )
          .onConflictDoUpdate({
            target: [
              assetObjectDeletions.bucket,
              assetObjectDeletions.objectKey,
            ],
            set: {
              reason: "upload_orphaned_promotion",
              attempts: 0,
              nextAttemptAt: input.now,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              completedAt: null,
              updatedAt: input.now,
            },
          });
      }
      await transaction
        .update(boardAssetUploads)
        .set({ status: "expired", updatedAt: input.now })
        .where(
          and(
            inArray(boardAssetUploads.id, ids),
            eq(boardAssetUploads.status, "pending"),
          ),
        );
      return expired.length;
    });
  },

  async expireAvatarUploads(input) {
    return db.transaction(async (transaction) => {
      const expired = await transaction
        .select({
          id: avatarUploadReservations.id,
          userId: avatarUploadReservations.userId,
          objectKey: avatarUploadReservations.r2ObjectKey,
        })
        .from(avatarUploadReservations)
        .where(
          and(
            eq(avatarUploadReservations.status, "pending"),
            lte(avatarUploadReservations.expiresAt, input.now),
          ),
        )
        .orderBy(
          asc(avatarUploadReservations.expiresAt),
          asc(avatarUploadReservations.id),
        )
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (expired.length === 0) return 0;

      const currentAvatars = await transaction
        .select({ objectKey: users.avatarObjectKey })
        .from(users)
        .where(inArray(users.id, expired.map((upload) => upload.userId)));
      const referencedKeys = new Set(
        currentAvatars.flatMap((avatar) =>
          avatar.objectKey ? [avatar.objectKey] : [],
        ),
      );
      await transaction
        .insert(assetObjectDeletions)
        .values(
          expired.map((upload) => ({
            bucket: "avatars" as const,
            objectKey: upload.objectKey,
            reason: "avatar_upload_expired",
            nextAttemptAt: input.now,
          })),
        )
        .onConflictDoNothing();
      const orphanedPromotions = expired
        .map((upload) => avatarFinalObjectKey(upload.userId, upload.id))
        .filter((objectKey) => !referencedKeys.has(objectKey));
      if (orphanedPromotions.length > 0) {
        await transaction
          .insert(assetObjectDeletions)
          .values(
            orphanedPromotions.map((objectKey) => ({
              bucket: "avatars" as const,
              objectKey,
              reason: "avatar_orphaned_promotion",
              nextAttemptAt: input.now,
            })),
          )
          .onConflictDoUpdate({
            target: [
              assetObjectDeletions.bucket,
              assetObjectDeletions.objectKey,
            ],
            set: {
              reason: "avatar_orphaned_promotion",
              attempts: 0,
              nextAttemptAt: input.now,
              leaseOwner: null,
              leaseExpiresAt: null,
              lastErrorCode: null,
              completedAt: null,
              updatedAt: input.now,
            },
          });
      }
      await transaction
        .update(avatarUploadReservations)
        .set({ status: "expired", updatedAt: input.now })
        .where(
          and(
            inArray(
              avatarUploadReservations.id,
              expired.map((upload) => upload.id),
            ),
            eq(avatarUploadReservations.status, "pending"),
          ),
        );
      return expired.length;
    });
  },

  async claimObjectDeletions(input) {
    return db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: assetObjectDeletions.id })
        .from(assetObjectDeletions)
        .where(
          and(
            isNull(assetObjectDeletions.completedAt),
            lte(assetObjectDeletions.nextAttemptAt, input.now),
            lt(assetObjectDeletions.attempts, MEDIA_CLEANUP_MAX_ATTEMPTS),
            or(
              isNull(assetObjectDeletions.leaseExpiresAt),
              lte(assetObjectDeletions.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(
          asc(assetObjectDeletions.nextAttemptAt),
          asc(assetObjectDeletions.createdAt),
          asc(assetObjectDeletions.id),
        )
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];

      const claimed = await transaction
        .update(assetObjectDeletions)
        .set({
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: input.leaseExpiresAt,
          attempts: sql`${assetObjectDeletions.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(assetObjectDeletions.id, candidates.map((job) => job.id)))
        .returning({
          id: assetObjectDeletions.id,
          bucket: assetObjectDeletions.bucket,
          objectKey: assetObjectDeletions.objectKey,
          attempt: assetObjectDeletions.attempts,
        });
      return claimed;
    });
  },

  async completeObjectDeletion(input) {
    const [completed] = await db
      .update(assetObjectDeletions)
      .set({
        completedAt: input.now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(assetObjectDeletions.id, input.id),
          eq(assetObjectDeletions.leaseOwner, input.leaseOwner),
          isNull(assetObjectDeletions.completedAt),
        ),
      )
      .returning({ id: assetObjectDeletions.id });
    return Boolean(completed);
  },

  async retryObjectDeletion(input) {
    const [released] = await db
      .update(assetObjectDeletions)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: input.errorCode,
        nextAttemptAt: input.nextAttemptAt,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(assetObjectDeletions.id, input.id),
          eq(assetObjectDeletions.leaseOwner, input.leaseOwner),
          isNull(assetObjectDeletions.completedAt),
        ),
      )
      .returning({ id: assetObjectDeletions.id });
    return Boolean(released);
  },
};
