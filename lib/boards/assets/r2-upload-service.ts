import "server-only";

import { randomUUID } from "node:crypto";

import {
  BOARD_ASSET_MAX_BYTES,
  boardAssetMaxBytesForMimeType,
  boardAssetSource,
  declaredMimeMatchesDetected,
  detectBoardAssetMimeType,
  type SupportedBoardAssetMimeType,
} from "@/lib/boards/assets/contracts";
import {
  boardAssetR2Repository,
  type BoardAssetR2Repository,
  type PendingBoardAssetUpload,
} from "@/lib/boards/assets/r2-repository";
import { BoardApiError } from "@/lib/boards/http";
import {
  getPrivateObjectStore,
  type InspectedR2Object,
  type PrivateObjectStore,
} from "@/lib/storage/r2/private-object-store";
import {
  boardAssetFinalObjectKey,
  boardAssetUploadObjectKey,
} from "@/lib/storage/r2/object-keys";

const METADATA = {
  hash: "fabric-content-sha256",
  size: "fabric-byte-size",
  type: "fabric-media-type",
  kind: "fabric-upload-kind",
} as const;

type Dependencies = Readonly<{
  repository: BoardAssetR2Repository;
  objectStore: PrivateObjectStore;
  now: () => Date;
  uuid: () => string;
}>;

const defaultDependencies = (): Dependencies => ({
  repository: boardAssetR2Repository,
  objectStore: getPrivateObjectStore(),
  now: () => new Date(),
  uuid: randomUUID,
});

function metadataFor(input: {
  contentHash: string;
  byteSize: number;
  mimeType: SupportedBoardAssetMimeType;
}): Readonly<Record<string, string>> {
  return {
    [METADATA.hash]: input.contentHash,
    [METADATA.size]: String(input.byteSize),
    [METADATA.type]: input.mimeType,
    [METADATA.kind]: "board-asset",
  };
}

function assertVerified(
  pending: PendingBoardAssetUpload,
  inspected: InspectedR2Object,
): void {
  const detected = detectBoardAssetMimeType(inspected.firstBytes);
  if (
    inspected.byteSize !== pending.byteSize ||
    inspected.contentHash !== pending.contentHash ||
    !declaredMimeMatchesDetected(inspected.contentType, pending.mimeType) ||
    detected !== pending.mimeType ||
    inspected.metadata[METADATA.hash] !== pending.contentHash ||
    inspected.metadata[METADATA.size] !== String(pending.byteSize) ||
    inspected.metadata[METADATA.type] !== pending.mimeType ||
    inspected.metadata[METADATA.kind] !== "board-asset" ||
    !inspected.etag
  ) {
    throw new BoardApiError(
      422,
      "asset_verification_failed",
      "The uploaded media did not match the authorized file.",
    );
  }
}

function responseFor(ready: {
  id: string;
  boardId: string;
  tldrawAssetId: string;
  mimeType: SupportedBoardAssetMimeType;
  byteSize: number;
  contentHash: string;
}) {
  return {
    asset: {
      id: ready.id,
      tldrawAssetId: ready.tldrawAssetId,
      src: boardAssetSource(ready.boardId, ready.id),
      mimeType: ready.mimeType,
      byteSize: ready.byteSize,
      contentHash: ready.contentHash,
    },
  } as const;
}

export async function initiateBoardAssetUpload(
  input: {
    userId: string;
    boardId: string;
    tldrawAssetId: string;
    mimeType: SupportedBoardAssetMimeType;
    originalName: string | null;
    byteSize: number;
    contentHash: string;
  },
  dependencies: Dependencies = defaultDependencies(),
) {
  const uploadId = dependencies.uuid();
  const r2ObjectKey = boardAssetUploadObjectKey(input.boardId, uploadId);
  const signedUpload = await dependencies.objectStore.createUpload({
    bucket: "board-assets",
    key: r2ObjectKey,
    contentType: input.mimeType,
    byteSize: input.byteSize,
    metadata: metadataFor(input),
    now: dependencies.now(),
  });
  const pending = await dependencies.repository.reserve({
    ...input,
    uploadId,
    r2ObjectKey,
    uploadExpiresAt: new Date(signedUpload.expiresAt),
  });

  return {
    upload: {
      id: pending.uploadId,
      method: signedUpload.method,
      url: signedUpload.url,
      headers: signedUpload.headers,
      expiresAt: signedUpload.expiresAt,
    },
  } as const;
}

export async function finalizeBoardAssetUpload(
  input: { userId: string; boardId: string; uploadId: string },
  dependencies: Dependencies = defaultDependencies(),
) {
  const alreadyFinalized = await dependencies.repository.getFinalized(input);
  if (alreadyFinalized) return responseFor(alreadyFinalized);

  let pending: PendingBoardAssetUpload;
  try {
    pending = await dependencies.repository.getPending(input);
  } catch (error) {
    const finalizedAfterRead =
      await dependencies.repository.getFinalized(input);
    if (finalizedAfterRead) return responseFor(finalizedAfterRead);
    throw error;
  }
  if (pending.uploadExpiresAt.getTime() <= dependencies.now().getTime()) {
    throw new BoardApiError(
      410,
      "asset_upload_expired",
      "This media upload has expired.",
    );
  }

  let inspected: InspectedR2Object;
  try {
    inspected = await dependencies.objectStore.inspect({
      bucket: "board-assets",
      key: pending.r2ObjectKey,
      maxBytes: Math.min(
        BOARD_ASSET_MAX_BYTES,
        boardAssetMaxBytesForMimeType(pending.mimeType),
      ),
    });
  } catch {
    const finalizedAfterInspect =
      await dependencies.repository.getFinalized(input);
    if (finalizedAfterInspect) return responseFor(finalizedAfterInspect);
    throw new BoardApiError(
      409,
      "asset_upload_not_ready",
      "The media upload is not available to finalize yet.",
    );
  }

  try {
    assertVerified(pending, inspected);
  } catch (error) {
    await Promise.allSettled([
      dependencies.objectStore.delete({
        bucket: "board-assets",
        key: pending.r2ObjectKey,
      }),
      dependencies.repository.reject(input),
    ]);
    throw error;
  }

  const r2ObjectKey = boardAssetFinalObjectKey(
    pending.boardId,
    pending.storageId,
    pending.contentHash,
  );
  let promoted;
  try {
    promoted = await dependencies.objectStore.promote({
      bucket: "board-assets",
      sourceKey: pending.r2ObjectKey,
      destinationKey: r2ObjectKey,
      sourceEtag: inspected.etag!,
    });
  } catch {
    throw new BoardApiError(
      409,
      "asset_promotion_failed",
      "The verified media could not be made ready yet.",
    );
  }

  let ready;
  try {
    ready = await dependencies.repository.finalize({
      ...input,
      r2ObjectKey,
      r2Etag: promoted.etag,
      r2Version: promoted.version,
    });
  } catch (error) {
    const finalizedAfterWrite =
      await dependencies.repository.getFinalized(input);
    if (finalizedAfterWrite) return responseFor(finalizedAfterWrite);
    // The database outcome may be ambiguous after a connection failure. Keep
    // the immutable promoted object so a retry can safely finish the pointer
    // swap; background orphan reconciliation can remove it if it stays unused.
    throw error;
  }
  return responseFor(ready);
}
