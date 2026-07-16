import "server-only";

import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import {
  assetObjectDeletions,
  avatarUploadReservations,
} from "@/db/schema/assets";
import { users } from "@/db/schema/auth";
import type {
  SupportedAvatarMimeType,
  UserAvatarProjection,
} from "@/lib/account/avatar-contracts";
import {
  AVATAR_MAX_OUTSTANDING_UPLOADS,
  avatarUploadCapacityAvailable,
  sameAvatarUploadIntent,
} from "@/lib/account/avatar-upload-policy";
import { BoardApiError } from "@/lib/boards/http";
import { avatarFinalObjectKey } from "@/lib/storage/r2/object-keys";

export { AVATAR_MAX_OUTSTANDING_UPLOADS };

export type AvatarUploadReservation = Readonly<{
  id: string;
  userId: string;
  mimeType: SupportedAvatarMimeType;
  byteSize: number;
  contentHash: string;
  r2ObjectKey: string;
  status: "pending" | "completed" | "rejected" | "expired";
  expiresAt: Date;
}>;

export interface AvatarRepository {
  get(userId: string): Promise<UserAvatarProjection>;
  reserveUpload(input: {
    uploadId: string;
    userId: string;
    mimeType: SupportedAvatarMimeType;
    byteSize: number;
    contentHash: string;
    r2ObjectKey: string;
    expiresAt: Date;
    now: Date;
  }): Promise<AvatarUploadReservation>;
  getUpload(input: {
    userId: string;
    uploadId: string;
  }): Promise<AvatarUploadReservation>;
  rejectUpload(input: {
    userId: string;
    uploadId: string;
    now: Date;
  }): Promise<void>;
  replace(input: {
    userId: string;
    uploadId: string;
    stagingObjectKey: string;
    avatarObjectKey: string;
    avatarContentHash: string;
    avatarMimeType: SupportedAvatarMimeType;
    avatarByteSize: number;
    avatarR2Etag: string;
    avatarR2Version: string | null;
    avatarUpdatedAt: Date;
  }): Promise<{ user: UserAvatarProjection; previousObjectKey: string | null }>;
  clear(userId: string): Promise<{
    user: UserAvatarProjection;
    previousObjectKey: string | null;
  }>;
}

const avatarSelection = {
  id: users.id,
  name: users.name,
  email: users.email,
  image: users.image,
  avatarObjectKey: users.avatarObjectKey,
  avatarContentHash: users.avatarContentHash,
  avatarMimeType: users.avatarMimeType,
  avatarByteSize: users.avatarByteSize,
  avatarR2Etag: users.avatarR2Etag,
  avatarR2Version: users.avatarR2Version,
  avatarUpdatedAt: users.avatarUpdatedAt,
};

function asReservation(
  value: typeof avatarUploadReservations.$inferSelect,
): AvatarUploadReservation {
  return {
    id: value.id,
    userId: value.userId,
    mimeType: value.mimeType as SupportedAvatarMimeType,
    byteSize: value.byteSize,
    contentHash: value.contentHash,
    r2ObjectKey: value.r2ObjectKey,
    status: value.status,
    expiresAt: value.expiresAt,
  };
}

function notFound(): BoardApiError {
  return new BoardApiError(
    404,
    "not_found",
    "The requested resource was not found.",
  );
}

function reservationConflict(): BoardApiError {
  return new BoardApiError(
    409,
    "avatar_upload_conflict",
    "This avatar upload request no longer matches its original reservation.",
  );
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function enqueueObjectDeletion(
  transaction: Transaction,
  input: {
    objectKey: string | null;
    reason: string;
    nextAttemptAt: Date;
    reopen?: boolean;
  },
): Promise<void> {
  if (!input.objectKey) return;
  const insert = transaction.insert(assetObjectDeletions).values({
    bucket: "avatars",
    objectKey: input.objectKey,
    reason: input.reason,
    nextAttemptAt: input.nextAttemptAt,
  });
  if (!input.reopen) {
    await insert.onConflictDoNothing();
    return;
  }
  await insert.onConflictDoUpdate({
    target: [assetObjectDeletions.bucket, assetObjectDeletions.objectKey],
    set: {
      reason: input.reason,
      nextAttemptAt: input.nextAttemptAt,
      attempts: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastErrorCode: null,
      completedAt: null,
      updatedAt: input.nextAttemptAt,
    },
  });
}

export const avatarRepository: AvatarRepository = {
  async get(userId) {
    const [user] = await db
      .select(avatarSelection)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw notFound();
    return user;
  },

  async reserveUpload(input) {
    return db.transaction(async (transaction) => {
      // Serializing reservations on the owning user makes the outstanding cap
      // strict under concurrent requests without throttling normal retries.
      const [user] = await transaction
        .select({ id: users.id, avatarObjectKey: users.avatarObjectKey })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update")
        .limit(1);
      if (!user) throw notFound();

      const expiredUploads = await transaction
        .select({
          id: avatarUploadReservations.id,
          objectKey: avatarUploadReservations.r2ObjectKey,
        })
        .from(avatarUploadReservations)
        .where(
          and(
            eq(avatarUploadReservations.userId, input.userId),
            eq(avatarUploadReservations.status, "pending"),
            lte(avatarUploadReservations.expiresAt, input.now),
          ),
        )
        .for("update");
      for (const expired of expiredUploads) {
        await enqueueObjectDeletion(transaction, {
          objectKey: expired.objectKey,
          reason: "avatar_upload_expired",
          nextAttemptAt: input.now,
        });
        const finalObjectKey = avatarFinalObjectKey(input.userId, expired.id);
        if (user.avatarObjectKey !== finalObjectKey) {
          await enqueueObjectDeletion(transaction, {
            objectKey: finalObjectKey,
            reason: "avatar_orphaned_promotion",
            nextAttemptAt: input.now,
            reopen: true,
          });
        }
      }
      if (expiredUploads.length > 0) {
        await transaction
          .update(avatarUploadReservations)
          .set({ status: "expired", updatedAt: input.now })
          .where(
            and(
              inArray(
                avatarUploadReservations.id,
                expiredUploads.map((upload) => upload.id),
              ),
              eq(avatarUploadReservations.status, "pending"),
            ),
          );
      }

      const [existingRow] = await transaction
        .select()
        .from(avatarUploadReservations)
        .where(eq(avatarUploadReservations.id, input.uploadId))
        .for("update")
        .limit(1);
      if (existingRow) {
        const existing = asReservation(existingRow);
        if (
          existing.status === "pending" &&
          existing.expiresAt.getTime() > input.now.getTime() &&
          sameAvatarUploadIntent(existing, input)
        ) {
          return existing;
        }
        throw reservationConflict();
      }

      const [usage] = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(avatarUploadReservations)
        .where(
          and(
            eq(avatarUploadReservations.userId, input.userId),
            eq(avatarUploadReservations.status, "pending"),
            gt(avatarUploadReservations.expiresAt, input.now),
          ),
        );
      if (!avatarUploadCapacityAvailable(Number(usage?.count ?? 0))) {
        throw new BoardApiError(
          409,
          "avatar_uploads_in_progress",
          "Several avatar uploads are already in progress. Finish one or retry after they expire.",
        );
      }

      const [reserved] = await transaction
        .insert(avatarUploadReservations)
        .values({
          id: input.uploadId,
          userId: input.userId,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          contentHash: input.contentHash,
          r2ObjectKey: input.r2ObjectKey,
          expiresAt: input.expiresAt,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!reserved) {
        throw new Error("Avatar upload reservation returned no row.");
      }
      await enqueueObjectDeletion(transaction, {
        objectKey: input.r2ObjectKey,
        reason: "avatar_upload_expired",
        nextAttemptAt: input.expiresAt,
      });
      return asReservation(reserved);
    });
  },

  async getUpload(input) {
    const [reservation] = await db
      .select()
      .from(avatarUploadReservations)
      .where(
        and(
          eq(avatarUploadReservations.id, input.uploadId),
          eq(avatarUploadReservations.userId, input.userId),
        ),
      )
      .limit(1);
    if (!reservation) throw notFound();
    return asReservation(reservation);
  },

  async rejectUpload(input) {
    await db.transaction(async (transaction) => {
      const [reservation] = await transaction
        .select({
          objectKey: avatarUploadReservations.r2ObjectKey,
          status: avatarUploadReservations.status,
        })
        .from(avatarUploadReservations)
        .where(
          and(
            eq(avatarUploadReservations.id, input.uploadId),
            eq(avatarUploadReservations.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!reservation || reservation.status !== "pending") return;
      await transaction
        .update(avatarUploadReservations)
        .set({ status: "rejected", updatedAt: input.now })
        .where(
          and(
            eq(avatarUploadReservations.id, input.uploadId),
            eq(avatarUploadReservations.status, "pending"),
          ),
        );
      await enqueueObjectDeletion(transaction, {
        objectKey: reservation.objectKey,
        reason: "avatar_upload_rejected",
        nextAttemptAt: input.now,
        reopen: true,
      });
    });
  },

  async replace(input) {
    return db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ avatarObjectKey: users.avatarObjectKey })
        .from(users)
        .where(eq(users.id, input.userId))
        .for("update")
        .limit(1);
      if (!current) throw notFound();

      const [reservation] = await transaction
        .select()
        .from(avatarUploadReservations)
        .where(
          and(
            eq(avatarUploadReservations.id, input.uploadId),
            eq(avatarUploadReservations.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!reservation) throw notFound();
      const reserved = asReservation(reservation);
      if (
        reserved.status !== "pending" ||
        reserved.expiresAt.getTime() <= input.avatarUpdatedAt.getTime() ||
        reserved.r2ObjectKey !== input.stagingObjectKey ||
        reserved.contentHash !== input.avatarContentHash ||
        reserved.mimeType !== input.avatarMimeType ||
        reserved.byteSize !== input.avatarByteSize
      ) {
        throw reservationConflict();
      }

      const [user] = await transaction
        .update(users)
        .set({
          avatarObjectKey: input.avatarObjectKey,
          avatarContentHash: input.avatarContentHash,
          avatarMimeType: input.avatarMimeType,
          avatarByteSize: input.avatarByteSize,
          avatarR2Etag: input.avatarR2Etag,
          avatarR2Version: input.avatarR2Version,
          avatarUpdatedAt: input.avatarUpdatedAt,
          updatedAt: input.avatarUpdatedAt,
        })
        .where(eq(users.id, input.userId))
        .returning(avatarSelection);
      if (!user) throw notFound();

      await transaction
        .update(avatarUploadReservations)
        .set({
          status: "completed",
          completedAt: input.avatarUpdatedAt,
          updatedAt: input.avatarUpdatedAt,
        })
        .where(
          and(
            eq(avatarUploadReservations.id, input.uploadId),
            eq(avatarUploadReservations.status, "pending"),
          ),
        );
      await enqueueObjectDeletion(transaction, {
        objectKey: input.stagingObjectKey,
        reason: "avatar_promoted",
        nextAttemptAt: input.avatarUpdatedAt,
        reopen: true,
      });
      if (current.avatarObjectKey !== input.avatarObjectKey) {
        await enqueueObjectDeletion(transaction, {
          objectKey: current.avatarObjectKey,
          reason: "avatar_replaced",
          nextAttemptAt: input.avatarUpdatedAt,
          reopen: true,
        });
      }
      return { user, previousObjectKey: current.avatarObjectKey };
    });
  },

  async clear(userId) {
    return db.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ avatarObjectKey: users.avatarObjectKey })
        .from(users)
        .where(eq(users.id, userId))
        .for("update")
        .limit(1);
      if (!current) throw notFound();
      const now = new Date();
      const [user] = await transaction
        .update(users)
        .set({
          avatarObjectKey: null,
          avatarContentHash: null,
          avatarMimeType: null,
          avatarByteSize: null,
          avatarR2Etag: null,
          avatarR2Version: null,
          avatarUpdatedAt: null,
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning(avatarSelection);
      if (!user) throw notFound();
      await enqueueObjectDeletion(transaction, {
        objectKey: current.avatarObjectKey,
        reason: "avatar_cleared",
        nextAttemptAt: now,
        reopen: true,
      });
      return { user, previousObjectKey: current.avatarObjectKey };
    });
  },
};
