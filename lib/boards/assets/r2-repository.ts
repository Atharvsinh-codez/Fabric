import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import {
  assetObjectDeletions,
  boardAssets,
  boardAssetUploads,
} from "@/db/schema/assets";
import { boards } from "@/db/schema/product";
import { requireBoardCapability } from "@/lib/boards/authorization";
import type { SupportedBoardAssetMimeType } from "@/lib/boards/assets/contracts";
import {
  BOARD_ASSET_BOARD_MAX_BYTES,
  BOARD_ASSET_BOARD_MAX_COUNT,
} from "@/lib/boards/assets/contracts";
import { BoardApiError } from "@/lib/boards/http";
import { boardAssetFinalObjectKey } from "@/lib/storage/r2/object-keys";

export type BoardAssetStorageState =
  "postgres_only" | "r2_ready" | "delete_pending";

export type PendingBoardAssetUpload = Readonly<{
  uploadId: string;
  storageId: string;
  boardId: string;
  tldrawAssetId: string;
  mimeType: SupportedBoardAssetMimeType;
  originalName: string | null;
  byteSize: number;
  contentHash: string;
  r2ObjectKey: string;
  uploadExpiresAt: Date;
}>;

export type ReadyBoardAsset = Readonly<{
  id: string;
  boardId: string;
  tldrawAssetId: string;
  mimeType: SupportedBoardAssetMimeType;
  byteSize: number;
  contentHash: string;
}>;

/**
 * Schema-facing boundary for the R2 rollout. Its implementation must perform
 * authorization and quota checks transactionally and compare storage_state /
 * upload_expires_at when finalizing. Keeping this boundary typed lets the media
 * flow land independently from the migration that adds the documented columns.
 */
export interface BoardAssetR2Repository {
  reserve(input: {
    userId: string;
    uploadId: string;
    boardId: string;
    tldrawAssetId: string;
    mimeType: SupportedBoardAssetMimeType;
    originalName: string | null;
    byteSize: number;
    contentHash: string;
    r2ObjectKey: string;
    uploadExpiresAt: Date;
  }): Promise<PendingBoardAssetUpload>;
  getPending(input: {
    userId: string;
    boardId: string;
    uploadId: string;
  }): Promise<PendingBoardAssetUpload>;
  getFinalized(input: {
    userId: string;
    boardId: string;
    uploadId: string;
  }): Promise<ReadyBoardAsset | null>;
  finalize(input: {
    userId: string;
    boardId: string;
    uploadId: string;
    r2ObjectKey: string;
    r2Etag: string;
    r2Version: string | null;
  }): Promise<ReadyBoardAsset>;
  reject(input: {
    userId: string;
    boardId: string;
    uploadId: string;
  }): Promise<void>;
}

function notFound(): BoardApiError {
  return new BoardApiError(
    404,
    "not_found",
    "The requested resource was not found.",
  );
}

function pendingSelection() {
  return {
    uploadId: boardAssetUploads.id,
    storageId: boardAssetUploads.storageId,
    boardId: boardAssetUploads.boardId,
    tldrawAssetId: boardAssetUploads.tldrawAssetId,
    mimeType: boardAssetUploads.mimeType,
    originalName: boardAssetUploads.originalName,
    byteSize: boardAssetUploads.byteSize,
    contentHash: boardAssetUploads.contentHash,
    r2ObjectKey: boardAssetUploads.r2ObjectKey,
    uploadExpiresAt: boardAssetUploads.expiresAt,
  } as const;
}

function asPending(
  row: Omit<PendingBoardAssetUpload, "mimeType"> & { mimeType: string },
): PendingBoardAssetUpload {
  return { ...row, mimeType: row.mimeType as SupportedBoardAssetMimeType };
}

const readySelection = {
  id: boardAssets.id,
  boardId: boardAssets.boardId,
  tldrawAssetId: boardAssets.tldrawAssetId,
  mimeType: boardAssets.mimeType,
  byteSize: boardAssets.byteSize,
  contentHash: boardAssets.contentHash,
} as const;

function asReady(
  row: Omit<ReadyBoardAsset, "mimeType"> & { mimeType: string },
): ReadyBoardAsset {
  return { ...row, mimeType: row.mimeType as SupportedBoardAssetMimeType };
}

export const boardAssetR2Repository: BoardAssetR2Repository = {
  async reserve(input) {
    await requireBoardCapability(input.userId, input.boardId, "edit_board");
    const now = new Date();

    return db.transaction(async (transaction) => {
      const [activeBoard] = await transaction
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, input.boardId), isNull(boards.archivedAt)))
        .for("update");
      if (!activeBoard) throw notFound();

      const expiredUploads = await transaction
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
            eq(boardAssetUploads.boardId, input.boardId),
            eq(boardAssetUploads.status, "pending"),
            lte(boardAssetUploads.expiresAt, now),
          ),
        )
        .for("update");
      if (expiredUploads.length > 0) {
        // The cleanup outbox and terminal reservation state commit together;
        // no R2 staging key can become ownerless during eager expiry.
        await transaction
          .insert(assetObjectDeletions)
          .values(
            expiredUploads.map((upload) => ({
              bucket: "board-assets" as const,
              objectKey: upload.objectKey,
              reason: "upload_expired",
              nextAttemptAt: now,
            })),
          )
          .onConflictDoNothing();
        const referencedObjects = await transaction
          .select({ objectKey: boardAssets.r2ObjectKey })
          .from(boardAssets)
          .where(
            inArray(
              boardAssets.id,
              expiredUploads.map((upload) => upload.storageId),
            ),
          );
        const referencedKeys = new Set(
          referencedObjects.flatMap((asset) =>
            asset.objectKey ? [asset.objectKey] : [],
          ),
        );
        const orphanedPromotions = expiredUploads
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
                nextAttemptAt: now,
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
                nextAttemptAt: now,
                leaseOwner: null,
                leaseExpiresAt: null,
                lastErrorCode: null,
                completedAt: null,
                updatedAt: now,
              },
            });
        }
        await transaction
          .update(boardAssetUploads)
          .set({ status: "expired", updatedAt: now })
          .where(
            and(
              inArray(
                boardAssetUploads.id,
                expiredUploads.map((upload) => upload.id),
              ),
              eq(boardAssetUploads.status, "pending"),
            ),
          );
      }

      const [activeUpload] = await transaction
        .select({ id: boardAssetUploads.id })
        .from(boardAssetUploads)
        .where(
          and(
            eq(boardAssetUploads.boardId, input.boardId),
            eq(boardAssetUploads.tldrawAssetId, input.tldrawAssetId),
            eq(boardAssetUploads.status, "pending"),
          ),
        )
        .limit(1);
      if (activeUpload) {
        throw new BoardApiError(
          409,
          "asset_upload_in_progress",
          "This media item already has an upload in progress.",
        );
      }

      const [usage] = await transaction
        .select({
          byteSize: sql<number>`coalesce(sum(${boardAssets.byteSize}), 0)::bigint`,
          assetCount: sql<number>`count(*)::int`,
        })
        .from(boardAssets)
        .where(eq(boardAssets.boardId, input.boardId));
      const [pendingUsage] = await transaction
        .select({
          byteSize: sql<number>`coalesce(sum(${boardAssetUploads.byteSize}), 0)::bigint`,
          assetCount: sql<number>`count(*)::int`,
        })
        .from(boardAssetUploads)
        .where(
          and(
            eq(boardAssetUploads.boardId, input.boardId),
            eq(boardAssetUploads.status, "pending"),
          ),
        );
      const [existing] = await transaction
        .select({ id: boardAssets.id, byteSize: boardAssets.byteSize })
        .from(boardAssets)
        .where(
          and(
            eq(boardAssets.boardId, input.boardId),
            eq(boardAssets.tldrawAssetId, input.tldrawAssetId),
          ),
        )
        .limit(1);

      const nextByteSize =
        Number(usage?.byteSize ?? 0) -
        (existing?.byteSize ?? 0) +
        Number(pendingUsage?.byteSize ?? 0) +
        input.byteSize;
      const nextAssetCount =
        Number(usage?.assetCount ?? 0) +
        (existing ? 0 : 1) +
        Number(pendingUsage?.assetCount ?? 0);
      if (
        nextByteSize > BOARD_ASSET_BOARD_MAX_BYTES ||
        nextAssetCount > BOARD_ASSET_BOARD_MAX_COUNT
      ) {
        throw new BoardApiError(
          413,
          "board_asset_limit",
          "This board has reached its private media storage limit.",
        );
      }

      const storageId = existing?.id ?? randomUUID();
      const [reserved] = await transaction
        .insert(boardAssetUploads)
        .values({
          id: input.uploadId,
          storageId,
          boardId: input.boardId,
          tldrawAssetId: input.tldrawAssetId,
          mimeType: input.mimeType,
          originalName: input.originalName,
          byteSize: input.byteSize,
          contentHash: input.contentHash,
          r2ObjectKey: input.r2ObjectKey,
          uploadedBy: input.userId,
          expiresAt: input.uploadExpiresAt,
        })
        .returning(pendingSelection());
      if (!reserved)
        throw new Error("Board asset upload reservation returned no row.");
      return asPending(reserved);
    });
  },

  async getPending(input) {
    await requireBoardCapability(input.userId, input.boardId, "edit_board");
    const [pending] = await db
      .select(pendingSelection())
      .from(boardAssetUploads)
      .innerJoin(boards, eq(boards.id, boardAssetUploads.boardId))
      .where(
        and(
          eq(boardAssetUploads.id, input.uploadId),
          eq(boardAssetUploads.boardId, input.boardId),
          eq(boardAssetUploads.uploadedBy, input.userId),
          eq(boardAssetUploads.status, "pending"),
          isNull(boards.archivedAt),
        ),
      )
      .limit(1);
    if (!pending) throw notFound();
    return asPending(pending);
  },

  async getFinalized(input) {
    await requireBoardCapability(input.userId, input.boardId, "edit_board");
    const [ready] = await db
      .select(readySelection)
      .from(boardAssetUploads)
      .innerJoin(
        boardAssets,
        and(
          eq(boardAssets.id, boardAssetUploads.storageId),
          eq(boardAssets.boardId, boardAssetUploads.boardId),
          eq(boardAssets.tldrawAssetId, boardAssetUploads.tldrawAssetId),
          eq(boardAssets.contentHash, boardAssetUploads.contentHash),
          eq(boardAssets.storageState, "r2_ready"),
        ),
      )
      .innerJoin(boards, eq(boards.id, boardAssetUploads.boardId))
      .where(
        and(
          eq(boardAssetUploads.id, input.uploadId),
          eq(boardAssetUploads.boardId, input.boardId),
          eq(boardAssetUploads.uploadedBy, input.userId),
          eq(boardAssetUploads.status, "completed"),
          isNull(boards.archivedAt),
        ),
      )
      .limit(1);
    return ready ? asReady(ready) : null;
  },

  async finalize(input) {
    await requireBoardCapability(input.userId, input.boardId, "edit_board");
    const now = new Date();

    return db.transaction(async (transaction) => {
      const [activeBoard] = await transaction
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, input.boardId), isNull(boards.archivedAt)))
        .for("update");
      if (!activeBoard) throw notFound();

      const [pending] = await transaction
        .select({
          ...pendingSelection(),
          uploadedBy: boardAssetUploads.uploadedBy,
          status: boardAssetUploads.status,
        })
        .from(boardAssetUploads)
        .where(
          and(
            eq(boardAssetUploads.id, input.uploadId),
            eq(boardAssetUploads.boardId, input.boardId),
            eq(boardAssetUploads.uploadedBy, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!pending) throw notFound();
      if (pending.status === "completed") {
        const [ready] = await transaction
          .select(readySelection)
          .from(boardAssets)
          .where(
            and(
              eq(boardAssets.id, pending.storageId),
              eq(boardAssets.boardId, pending.boardId),
              eq(boardAssets.tldrawAssetId, pending.tldrawAssetId),
              eq(boardAssets.contentHash, pending.contentHash),
              eq(boardAssets.r2ObjectKey, input.r2ObjectKey),
              eq(boardAssets.storageState, "r2_ready"),
            ),
          )
          .limit(1);
        if (!ready) throw notFound();
        return asReady(ready);
      }
      if (
        pending.status !== "pending" ||
        pending.uploadExpiresAt.getTime() <= now.getTime()
      ) {
        throw notFound();
      }

      const [replaced] = await transaction
        .select({ r2ObjectKey: boardAssets.r2ObjectKey })
        .from(boardAssets)
        .where(
          and(
            eq(boardAssets.boardId, pending.boardId),
            eq(boardAssets.tldrawAssetId, pending.tldrawAssetId),
          ),
        )
        .for("update")
        .limit(1);

      const [ready] = await transaction
        .insert(boardAssets)
        .values({
          id: pending.storageId,
          boardId: pending.boardId,
          tldrawAssetId: pending.tldrawAssetId,
          mimeType: pending.mimeType,
          originalName: pending.originalName,
          byteSize: pending.byteSize,
          contentHash: pending.contentHash,
          content: null,
          storageState: "r2_ready",
          r2ObjectKey: input.r2ObjectKey,
          r2Etag: input.r2Etag,
          r2Version: input.r2Version,
          r2VerifiedAt: now,
          uploadedBy: input.userId,
        })
        .onConflictDoUpdate({
          target: [boardAssets.boardId, boardAssets.tldrawAssetId],
          set: {
            mimeType: pending.mimeType,
            originalName: pending.originalName,
            byteSize: pending.byteSize,
            contentHash: pending.contentHash,
            content: null,
            storageState: "r2_ready",
            r2ObjectKey: input.r2ObjectKey,
            r2Etag: input.r2Etag,
            r2Version: input.r2Version,
            r2VerifiedAt: now,
            uploadedBy: input.userId,
            updatedAt: now,
          },
        })
        .returning({
          id: boardAssets.id,
          boardId: boardAssets.boardId,
          tldrawAssetId: boardAssets.tldrawAssetId,
          mimeType: boardAssets.mimeType,
          byteSize: boardAssets.byteSize,
          contentHash: boardAssets.contentHash,
        });
      if (!ready) throw new Error("Board asset finalization returned no row.");

      if (replaced?.r2ObjectKey && replaced.r2ObjectKey !== input.r2ObjectKey) {
        await transaction
          .insert(assetObjectDeletions)
          .values({
            bucket: "board-assets",
            objectKey: replaced.r2ObjectKey,
            reason: "asset_replaced",
          })
          .onConflictDoNothing();
      }

      if (pending.r2ObjectKey !== input.r2ObjectKey) {
        await transaction
          .insert(assetObjectDeletions)
          .values({
            bucket: "board-assets",
            objectKey: pending.r2ObjectKey,
            reason: "upload_promoted",
          })
          .onConflictDoNothing();
      }

      await transaction
        .update(boardAssetUploads)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(
          and(
            eq(boardAssetUploads.id, input.uploadId),
            eq(boardAssetUploads.status, "pending"),
          ),
        );
      return asReady(ready);
    });
  },

  async reject(input) {
    await requireBoardCapability(input.userId, input.boardId, "edit_board");
    await db.transaction(async (transaction) => {
      const [pending] = await transaction
        .select({ objectKey: boardAssetUploads.r2ObjectKey })
        .from(boardAssetUploads)
        .where(
          and(
            eq(boardAssetUploads.id, input.uploadId),
            eq(boardAssetUploads.boardId, input.boardId),
            eq(boardAssetUploads.uploadedBy, input.userId),
            eq(boardAssetUploads.status, "pending"),
          ),
        )
        .for("update")
        .limit(1);
      if (!pending) return;
      const now = new Date();
      await transaction
        .update(boardAssetUploads)
        .set({ status: "rejected", updatedAt: now })
        .where(
          and(
            eq(boardAssetUploads.id, input.uploadId),
            eq(boardAssetUploads.status, "pending"),
          ),
        );
      await transaction
        .insert(assetObjectDeletions)
        .values({
          bucket: "board-assets",
          objectKey: pending.objectKey,
          reason: "upload_rejected",
          nextAttemptAt: now,
        })
        .onConflictDoNothing();
    });
  },
};
