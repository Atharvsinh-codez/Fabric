"use client";

import type { TLAssetStore } from "tldraw";

import {
  BOARD_ASSET_DELETE_BATCH_SIZE,
  SUPPORTED_BOARD_ASSET_MIME_TYPES,
  boardAssetKind,
  boardAssetMaxBytesForMimeType,
  BoardAssetStorageIdSchema,
  BoardAssetUploadIdSchema,
  TldrawAssetIdSchema,
  boardAssetSource,
  sharedBoardAssetSource,
  type SupportedBoardAssetMimeType,
} from "@/lib/boards/assets/contracts";
import {
  fetchFinalizeWithRetry,
  transferWriteOnceUpload,
} from "@/lib/storage/r2/upload-retry-client";

type FabricAssetAccess =
  Readonly<{ kind: "member" }> | Readonly<{ kind: "share"; token: string }>;

export type FabricTldrawAssetStoreOptions = Readonly<{
  boardId: string;
  access?: FabricAssetAccess;
  fetch?: typeof fetch;
  r2UploadsEnabled?: boolean;
}>;

type UploadResponse = Readonly<{
  asset: Readonly<{
    id: string;
    src: string;
    mimeType: string;
    byteSize: number;
    contentHash: string;
  }>;
}>;

type UploadInitResponse = Readonly<{
  upload: Readonly<{
    id: string;
    method: "PUT";
    url: string;
    headers: Readonly<Record<string, string>>;
    expiresAt: string;
  }>;
}>;

function getErrorMessage(payload: unknown, fallback: string): string {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    payload.error &&
    typeof payload.error === "object" &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return payload.error.message;
  }
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseUploadResponse(payload: unknown): UploadResponse | null {
  if (!payload || typeof payload !== "object" || !("asset" in payload))
    return null;
  const asset = payload.asset;
  if (!asset || typeof asset !== "object") return null;
  if (
    !("id" in asset) ||
    !("src" in asset) ||
    !("mimeType" in asset) ||
    !("byteSize" in asset) ||
    !("contentHash" in asset) ||
    typeof asset.id !== "string" ||
    typeof asset.src !== "string" ||
    typeof asset.mimeType !== "string" ||
    typeof asset.byteSize !== "number" ||
    typeof asset.contentHash !== "string" ||
    !BoardAssetStorageIdSchema.safeParse(asset.id).success
  ) {
    return null;
  }
  return { asset: asset as UploadResponse["asset"] };
}

function parseUploadInitResponse(payload: unknown): UploadInitResponse | null {
  if (!payload || typeof payload !== "object" || !("upload" in payload))
    return null;
  const upload = payload.upload;
  if (!upload || typeof upload !== "object") return null;
  if (
    !("id" in upload) ||
    !("method" in upload) ||
    !("url" in upload) ||
    !("headers" in upload) ||
    !("expiresAt" in upload) ||
    typeof upload.id !== "string" ||
    upload.method !== "PUT" ||
    typeof upload.url !== "string" ||
    typeof upload.headers !== "object" ||
    !upload.headers ||
    typeof upload.expiresAt !== "string" ||
    !BoardAssetUploadIdSchema.safeParse(upload.id).success
  ) {
    return null;
  }
  try {
    const target = new URL(upload.url);
    if (target.protocol !== "https:") return null;
  } catch {
    return null;
  }
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(upload.headers)) {
    const normalized = name.toLowerCase();
    if (
      typeof value !== "string" ||
      (normalized !== "content-type" &&
        normalized !== "if-none-match" &&
        !normalized.startsWith("x-amz-meta-fabric-"))
    ) {
      return null;
    }
    headers[normalized] = value;
  }
  if (!headers["content-type"] || headers["if-none-match"] !== "*") return null;
  return {
    upload: {
      id: upload.id,
      method: "PUT",
      url: upload.url,
      headers,
      expiresAt: upload.expiresAt,
    },
  };
}

function normalizedFileMimeType(
  file: File,
): SupportedBoardAssetMimeType | null {
  const value = file.type.split(";", 1)[0]?.trim().toLowerCase();
  const normalized = value === "image/jpg" ? "image/jpeg" : value;
  return (
    SUPPORTED_BOARD_ASSET_MIME_TYPES.find(
      (mimeType) => mimeType === normalized,
    ) ?? null
  );
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function storageIdFromBoardAssetSource(
  source: string,
  boardId: string,
): string | null {
  const prefix = `${boardAssetSource(boardId, "")}`;
  if (!source.startsWith(prefix)) return null;
  const storageId = source.slice(prefix.length);
  const parsed = BoardAssetStorageIdSchema.safeParse(storageId);
  return parsed.success ? parsed.data : null;
}

/**
 * Board-scoped tldraw binary adapter. Persist this store's member URL in asset
 * records; share views rewrite that URL at resolve-time so bearer tokens never
 * enter the durable board document.
 */
export function createFabricTldrawAssetStore(
  options: FabricTldrawAssetStoreOptions,
): TLAssetStore {
  const access = options.access ?? { kind: "member" as const };
  const r2UploadsEnabled = options.r2UploadsEnabled ?? true;
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);
  const collectionPath = `/api/boards/${options.boardId}/assets`;
  const uploadPath = `${collectionPath}/uploads`;

  return {
    async upload(asset, file, abortSignal) {
      if (access.kind !== "member") {
        throw new Error("Shared boards cannot upload assets.");
      }
      if (!TldrawAssetIdSchema.safeParse(asset.id).success) {
        throw new Error("The tldraw asset ID is invalid.");
      }
      if (file.size <= 0)
        throw new Error("Choose a non-empty media file to upload.");
      const mimeType = normalizedFileMimeType(file);
      if (!mimeType) {
        throw new Error("Upload a PNG, JPEG, GIF, WebP, MP4, or WebM file.");
      }
      const kind = boardAssetKind(mimeType);
      const maxBytes = boardAssetMaxBytesForMimeType(mimeType);
      if (file.size > maxBytes) {
        throw new Error(
          kind === "video"
            ? "Videos must be 50 MiB or smaller."
            : "Images must be 5 MiB or smaller.",
        );
      }

      if (!r2UploadsEnabled) {
        if (kind !== "image") {
          throw new Error(
            "Video uploads are not available in this workspace yet.",
          );
        }
        const originalName =
          Array.from(file.name.trim()).slice(0, 180).join("") || "image";
        const response = await fetchRequest(
          `${collectionPath}?assetId=${encodeURIComponent(asset.id)}`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": mimeType,
              "x-fabric-asset-name": encodeURIComponent(originalName),
            },
            body: file,
            signal: abortSignal,
          },
        );
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(
            getErrorMessage(payload, "Fabric could not store this image."),
          );
        }
        const result = parseUploadResponse(payload);
        if (!result) {
          throw new Error("Fabric returned an invalid image upload response.");
        }
        return {
          src: result.asset.src,
          meta: {
            fabricStorageId: result.asset.id,
            fabricContentHash: result.asset.contentHash,
          },
        };
      }

      const contentHash = await sha256Hex(file);
      const initResponse = await fetchRequest(uploadPath, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          mimeType,
          byteSize: file.size,
          contentHash,
          originalName:
            Array.from(file.name.trim()).slice(0, 180).join("") || null,
        }),
        signal: abortSignal,
      });
      const initPayload = await readJson(initResponse);
      if (!initResponse.ok) {
        throw new Error(
          getErrorMessage(
            initPayload,
            `Fabric could not start this ${kind} upload.`,
          ),
        );
      }
      const initiated = parseUploadInitResponse(initPayload);
      if (!initiated)
        throw new Error("Fabric returned an invalid media upload grant.");

      const transferred = await transferWriteOnceUpload({
        fetcher: fetchRequest,
        url: initiated.upload.url,
        headers: initiated.upload.headers,
        body: file,
        signal: abortSignal,
      });
      if (!transferred) {
        throw new Error(
          `Fabric could not transfer this ${kind} to private storage.`,
        );
      }

      const finalizeResponse = await fetchFinalizeWithRetry({
        signal: abortSignal,
        request: () =>
          fetchRequest(`${uploadPath}/${initiated.upload.id}/finalize`, {
            method: "POST",
            credentials: "same-origin",
            signal: abortSignal,
          }),
      });
      const finalizePayload = await readJson(finalizeResponse);
      if (!finalizeResponse.ok) {
        throw new Error(
          getErrorMessage(
            finalizePayload,
            `Fabric could not finalize this ${kind}.`,
          ),
        );
      }
      const result = parseUploadResponse(finalizePayload);
      if (!result)
        throw new Error("Fabric returned an invalid asset upload response.");

      return {
        src: result.asset.src,
        meta: {
          fabricStorageId: result.asset.id,
          fabricContentHash: result.asset.contentHash,
        },
      };
    },

    resolve(asset) {
      const source = asset.props.src;
      if (!source || access.kind === "member") return source;
      const storageId = storageIdFromBoardAssetSource(source, options.boardId);
      return storageId
        ? sharedBoardAssetSource(access.token, storageId)
        : source;
    },

    async remove(assetIds) {
      if (assetIds.length === 0) return;
      if (access.kind !== "member") {
        throw new Error("Shared boards cannot remove assets.");
      }
      for (
        let index = 0;
        index < assetIds.length;
        index += BOARD_ASSET_DELETE_BATCH_SIZE
      ) {
        const response = await fetchRequest(collectionPath, {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetIds: assetIds.slice(
              index,
              index + BOARD_ASSET_DELETE_BATCH_SIZE,
            ),
          }),
        });
        if (!response.ok) {
          const payload = await readJson(response);
          throw new Error(
            getErrorMessage(payload, "Fabric could not remove this media."),
          );
        }
      }
    },
  };
}
