import { z } from "zod";

export const BOARD_ASSET_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BOARD_ASSET_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const BOARD_ASSET_MAX_BYTES = BOARD_ASSET_VIDEO_MAX_BYTES;
export const BOARD_ASSET_BOARD_MAX_BYTES = 1024 * 1024 * 1024;
export const BOARD_ASSET_BOARD_MAX_COUNT = 1_000;
export const BOARD_ASSET_DELETE_BATCH_SIZE = 100;

export const SUPPORTED_BOARD_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const SUPPORTED_BOARD_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
] as const;

export const SUPPORTED_BOARD_ASSET_MIME_TYPES = [
  ...SUPPORTED_BOARD_IMAGE_MIME_TYPES,
  ...SUPPORTED_BOARD_VIDEO_MIME_TYPES,
] as const;

export type SupportedBoardAssetMimeType =
  (typeof SUPPORTED_BOARD_ASSET_MIME_TYPES)[number];
export type SupportedBoardImageMimeType =
  (typeof SUPPORTED_BOARD_IMAGE_MIME_TYPES)[number];

export type BoardImageAssetSummary = Readonly<{
  id: string;
  tldrawAssetId: string;
  src: string;
  mimeType: SupportedBoardImageMimeType;
  originalName: string | null;
  byteSize: number;
  updatedAt: string;
}>;

export const TldrawAssetIdSchema = z
  .string()
  .min(7)
  .max(186)
  .regex(/^asset:[A-Za-z0-9_-]{1,180}$/);

export const BoardAssetStorageIdSchema = z.string().uuid();
export const BoardAssetUploadIdSchema = z.string().uuid();
export const BoardAssetShareTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/);
export const BoardAssetContentHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const BoardAssetUploadInitSchema = z
  .object({
    assetId: TldrawAssetIdSchema,
    mimeType: z.enum(SUPPORTED_BOARD_ASSET_MIME_TYPES),
    byteSize: z.number().int().positive().max(BOARD_ASSET_MAX_BYTES),
    contentHash: BoardAssetContentHashSchema,
    originalName: z.string().trim().min(1).max(180).nullable().default(null),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.byteSize > boardAssetMaxBytesForMimeType(value.mimeType)) {
      context.addIssue({
        code: "too_big",
        maximum: boardAssetMaxBytesForMimeType(value.mimeType),
        inclusive: true,
        origin: "number",
        path: ["byteSize"],
        message: "The asset is too large for its media type.",
      });
    }
  });

export const DeleteBoardAssetsSchema = z
  .object({
    assetIds: z
      .array(TldrawAssetIdSchema)
      .min(1)
      .max(BOARD_ASSET_DELETE_BATCH_SIZE),
  })
  .strict()
  .refine((value) => new Set(value.assetIds).size === value.assetIds.length, {
    message: "Asset IDs must be unique.",
    path: ["assetIds"],
  });

function hasPrefix(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function detectBoardAssetMimeType(
  bytes: Uint8Array,
): SupportedBoardAssetMimeType | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    hasPrefix(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    hasPrefix(bytes.subarray(4), [0x66, 0x74, 0x79, 0x70])
  ) {
    return "video/mp4";
  }
  if (hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return "video/webm";
  }
  return null;
}

export function boardAssetMaxBytesForMimeType(
  mimeType: SupportedBoardAssetMimeType,
): number {
  return mimeType.startsWith("video/")
    ? BOARD_ASSET_VIDEO_MAX_BYTES
    : BOARD_ASSET_IMAGE_MAX_BYTES;
}

export function boardAssetKind(
  mimeType: SupportedBoardAssetMimeType,
): "image" | "video" {
  return mimeType.startsWith("video/") ? "video" : "image";
}

export function declaredMimeMatchesDetected(
  declaredContentType: string | null,
  detected: SupportedBoardAssetMimeType,
): boolean {
  const normalized = declaredContentType
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return true;
  if (normalized === "image/jpg") return detected === "image/jpeg";
  return normalized === detected;
}

export function decodeAssetFileName(encodedName: string | null): string | null {
  if (!encodedName) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedName);
  } catch {
    return null;
  }

  const basename = decoded
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!basename) return null;
  return Array.from(basename).slice(0, 180).join("");
}

export function boardAssetSource(boardId: string, storageId: string): string {
  return `/api/boards/${boardId}/assets/${storageId}`;
}

export function sharedBoardAssetSource(
  shareToken: string,
  storageId: string,
): string {
  return `/api/shares/${shareToken}/assets/${storageId}`;
}
