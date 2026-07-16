import "server-only";

import type { SupportedBoardAssetMimeType } from "@/lib/boards/assets/contracts";
import type { BoardAssetStorageState } from "@/lib/boards/assets/r2-repository";
import { BoardApiError } from "@/lib/boards/http";
import {
  getPrivateObjectStore,
  type PrivateObjectStore,
} from "@/lib/storage/r2/private-object-store";

const EXTENSIONS: Record<SupportedBoardAssetMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

type BoardAssetResponseRecord = Readonly<{
  id: string;
  mimeType: string;
  byteSize: number;
  contentHash: string;
  content: Uint8Array | null;
  storageState?: BoardAssetStorageState;
  r2ObjectKey?: string | null;
}>;

type ByteRange = Readonly<{ start: number; end: number }>;

function parseByteRange(header: string | null, byteSize: number): ByteRange | null | false {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return false;
  const [, startText = "", endText = ""] = match;
  if (!startText && !endText) return false;

  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return false;
    return { start: Math.max(0, byteSize - suffixLength), end: byteSize - 1 };
  }

  const start = Number(startText);
  const requestedEnd = endText ? Number(endText) : byteSize - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= byteSize
  ) {
    return false;
  }
  return { start, end: Math.min(requestedEnd, byteSize - 1) };
}

function responseHeaders(
  asset: BoardAssetResponseRecord,
  access: "member" | "share",
): Headers {
  const extension = EXTENSIONS[asset.mimeType as SupportedBoardAssetMimeType] ?? "bin";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
    "Content-Disposition": `inline; filename="${asset.id}.${extension}"`,
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": asset.mimeType,
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: `"sha256-${asset.contentHash}"`,
    "Referrer-Policy": "no-referrer",
    "Surrogate-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (access === "member") headers.set("Vary", "Cookie");
  return headers;
}

export async function createBoardAssetResponse(
  asset: BoardAssetResponseRecord,
  access: "member" | "share",
  request: Request,
  objectStore?: PrivateObjectStore,
): Promise<Response> {
  const headers = responseHeaders(asset, access);
  const requestedRange =
    request.headers.get("if-range") && request.headers.get("if-range") !== headers.get("etag")
      ? null
      : request.headers.get("range");
  const range = parseByteRange(requestedRange, asset.byteSize);
  if (range === false) {
    headers.set("Content-Range", `bytes */${asset.byteSize}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  }

  const storageState = asset.storageState ?? "postgres_only";
  if (storageState === "r2_ready") {
    if (!asset.r2ObjectKey) throw new Error("Ready R2 asset is missing its object key.");
    const object = await (objectStore ?? getPrivateObjectStore()).get({
      bucket: "board-assets",
      key: asset.r2ObjectKey,
      range: range ? `bytes=${range.start}-${range.end}` : null,
    });
    headers.set(
      "Content-Length",
      String(range ? range.end - range.start + 1 : object.byteSize ?? asset.byteSize),
    );
    if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${asset.byteSize}`);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  }

  if (storageState !== "postgres_only" || !asset.content) {
    throw new BoardApiError(404, "not_found", "The requested resource was not found.");
  }
  const bytes = range ? asset.content.subarray(range.start, range.end + 1) : asset.content;
  headers.set("Content-Length", String(bytes.byteLength));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${asset.byteSize}`);
  return new Response(Uint8Array.from(bytes).buffer, {
    status: range ? 206 : 200,
    headers,
  });
}
