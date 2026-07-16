import "server-only";

import { createHash } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { assetObjectDeletions, boardAssets } from "@/db/schema/assets";
import { boardShareLinks, boards } from "@/db/schema/product";
import { requireBoardCapability } from "@/lib/boards/authorization";
import {
  BOARD_ASSET_BOARD_MAX_BYTES,
  BOARD_ASSET_BOARD_MAX_COUNT,
  BoardAssetShareTokenSchema,
  SUPPORTED_BOARD_IMAGE_MIME_TYPES,
  boardAssetSource,
  type BoardImageAssetSummary,
  type SupportedBoardAssetMimeType,
} from "@/lib/boards/assets/contracts";
import { BoardApiError } from "@/lib/boards/http";

type StoredBoardAsset = {
  id: string;
  boardId: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  content: Uint8Array | null;
  storageState: "postgres_only" | "r2_ready" | "delete_pending";
  r2ObjectKey: string | null;
};

const storedAssetSelection = {
  id: boardAssets.id,
  boardId: boardAssets.boardId,
  mimeType: boardAssets.mimeType,
  byteSize: boardAssets.byteSize,
  contentHash: boardAssets.contentHash,
  content: boardAssets.content,
  storageState: boardAssets.storageState,
  r2ObjectKey: boardAssets.r2ObjectKey,
};

function notFound(): BoardApiError {
  return new BoardApiError(
    404,
    "not_found",
    "The requested resource was not found.",
  );
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Only returns browser-safe metadata and stable same-origin member URLs. */
export async function listBoardImageAssets(input: {
  userId: string;
  boardId: string;
}): Promise<BoardImageAssetSummary[]> {
  await requireBoardCapability(input.userId, input.boardId, "view");
  const rows = await db
    .select({
      id: boardAssets.id,
      tldrawAssetId: boardAssets.tldrawAssetId,
      mimeType: boardAssets.mimeType,
      originalName: boardAssets.originalName,
      byteSize: boardAssets.byteSize,
      updatedAt: boardAssets.updatedAt,
    })
    .from(boardAssets)
    .innerJoin(boards, eq(boards.id, boardAssets.boardId))
    .where(
      and(
        eq(boardAssets.boardId, input.boardId),
        isNull(boards.archivedAt),
        inArray(boardAssets.mimeType, [...SUPPORTED_BOARD_IMAGE_MIME_TYPES]),
        inArray(boardAssets.storageState, ["postgres_only", "r2_ready"]),
      ),
    )
    .orderBy(desc(boardAssets.updatedAt), desc(boardAssets.id))
    .limit(BOARD_ASSET_BOARD_MAX_COUNT);

  return rows.map((row) => ({
    ...row,
    src: boardAssetSource(input.boardId, row.id),
    mimeType: row.mimeType as BoardImageAssetSummary["mimeType"],
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function storeBoardAsset(input: {
  userId: string;
  boardId: string;
  tldrawAssetId: string;
  mimeType: SupportedBoardAssetMimeType;
  originalName: string | null;
  content: Uint8Array;
}) {
  await requireBoardCapability(input.userId, input.boardId, "edit_board");

  return db.transaction(async (transaction) => {
    const [activeBoard] = await transaction
      .select({ id: boards.id })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), isNull(boards.archivedAt)))
      .for("update");
    if (!activeBoard) throw notFound();

    const [usage] = await transaction
      .select({
        byteSize: sql<number>`coalesce(sum(${boardAssets.byteSize}), 0)::bigint`,
        assetCount: sql<number>`count(*)::int`,
      })
      .from(boardAssets)
      .where(eq(boardAssets.boardId, input.boardId));
    const [existing] = await transaction
      .select({
        byteSize: boardAssets.byteSize,
        r2ObjectKey: boardAssets.r2ObjectKey,
      })
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
      input.content.byteLength;
    const nextAssetCount = Number(usage?.assetCount ?? 0) + (existing ? 0 : 1);
    if (
      nextByteSize > BOARD_ASSET_BOARD_MAX_BYTES ||
      nextAssetCount > BOARD_ASSET_BOARD_MAX_COUNT
    ) {
      throw new BoardApiError(
        413,
        "board_asset_limit",
        "This board has reached its private asset storage limit.",
      );
    }

    const now = new Date();
    const contentHash = createHash("sha256")
      .update(input.content)
      .digest("hex");
    const [stored] = await transaction
      .insert(boardAssets)
      .values({
        boardId: input.boardId,
        tldrawAssetId: input.tldrawAssetId,
        mimeType: input.mimeType,
        originalName: input.originalName,
        byteSize: input.content.byteLength,
        contentHash,
        content: input.content,
        uploadedBy: input.userId,
      })
      .onConflictDoUpdate({
        target: [boardAssets.boardId, boardAssets.tldrawAssetId],
        set: {
          mimeType: input.mimeType,
          originalName: input.originalName,
          byteSize: input.content.byteLength,
          contentHash,
          content: input.content,
          storageState: "postgres_only",
          r2ObjectKey: null,
          r2Etag: null,
          r2Version: null,
          r2VerifiedAt: null,
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
        createdAt: boardAssets.createdAt,
        updatedAt: boardAssets.updatedAt,
      });
    if (!stored) throw new Error("Board asset insert returned no row.");
    if (existing?.r2ObjectKey) {
      await transaction
        .insert(assetObjectDeletions)
        .values({
          bucket: "board-assets",
          objectKey: existing.r2ObjectKey,
          reason: "asset_replaced_legacy",
        })
        .onConflictDoNothing();
    }
    return stored;
  });
}

export async function deleteBoardAssets(input: {
  userId: string;
  boardId: string;
  tldrawAssetIds: string[];
}): Promise<{ deletedCount: number }> {
  await requireBoardCapability(input.userId, input.boardId, "edit_board");

  return db.transaction(async (transaction) => {
    const [activeBoard] = await transaction
      .select({ id: boards.id, cover: boards.cover })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), isNull(boards.archivedAt)))
      .for("update");
    if (!activeBoard) throw notFound();

    const candidates = await transaction
      .select({ id: boardAssets.id, r2ObjectKey: boardAssets.r2ObjectKey })
      .from(boardAssets)
      .where(
        and(
          eq(boardAssets.boardId, input.boardId),
          inArray(boardAssets.tldrawAssetId, input.tldrawAssetIds),
        ),
      );
    const objectKeys = candidates.flatMap((asset) =>
      asset.r2ObjectKey ? [asset.r2ObjectKey] : [],
    );
    if (objectKeys.length > 0) {
      await transaction
        .insert(assetObjectDeletions)
        .values(
          objectKeys.map((objectKey) => ({
            bucket: "board-assets" as const,
            objectKey,
            reason: "asset_deleted",
          })),
        )
        .onConflictDoNothing();
    }

    const coverAssetId =
      activeBoard.cover?.kind === "asset" ? activeBoard.cover.assetId : null;
    if (coverAssetId && candidates.some((asset) => asset.id === coverAssetId)) {
      await transaction
        .update(boards)
        .set({ cover: null, updatedAt: new Date() })
        .where(eq(boards.id, input.boardId));
    }

    const deleted = await transaction
      .delete(boardAssets)
      .where(
        and(
          eq(boardAssets.boardId, input.boardId),
          inArray(boardAssets.tldrawAssetId, input.tldrawAssetIds),
        ),
      )
      .returning({ id: boardAssets.id });
    return { deletedCount: deleted.length };
  });
}

export async function getBoardAsset(input: {
  userId: string;
  boardId: string;
  storageId: string;
}): Promise<StoredBoardAsset> {
  await requireBoardCapability(input.userId, input.boardId, "view");
  const [asset] = await db
    .select(storedAssetSelection)
    .from(boardAssets)
    .where(
      and(
        eq(boardAssets.id, input.storageId),
        eq(boardAssets.boardId, input.boardId),
        inArray(boardAssets.storageState, ["postgres_only", "r2_ready"]),
      ),
    )
    .limit(1);
  if (!asset) throw notFound();
  return asset;
}

export async function getSharedBoardAsset(input: {
  shareToken: string;
  storageId: string;
}): Promise<StoredBoardAsset> {
  const token = BoardAssetShareTokenSchema.safeParse(input.shareToken);
  if (!token.success) throw notFound();

  const now = new Date();
  const [asset] = await db
    .select(storedAssetSelection)
    .from(boardAssets)
    .innerJoin(boards, eq(boards.id, boardAssets.boardId))
    .innerJoin(
      boardShareLinks,
      eq(boardShareLinks.boardId, boardAssets.boardId),
    )
    .where(
      and(
        eq(boardAssets.id, input.storageId),
        eq(boardShareLinks.tokenHash, hashShareToken(token.data)),
        isNull(boardShareLinks.revokedAt),
        isNull(boards.archivedAt),
        inArray(boardAssets.storageState, ["postgres_only", "r2_ready"]),
        or(
          isNull(boardShareLinks.expiresAt),
          gt(boardShareLinks.expiresAt, now),
        ),
      ),
    )
    .limit(1);
  if (!asset) throw notFound();
  return asset;
}
