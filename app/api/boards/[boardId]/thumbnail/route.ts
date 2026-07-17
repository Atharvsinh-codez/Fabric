import { createHash } from "node:crypto";

import { requirePrincipal } from "@/lib/auth/require-principal";
import { UuidSchema } from "@/lib/boards/contracts";
import { BoardApiError, handleApiError, invalidRequest } from "@/lib/boards/http";
import {
  getBoardPreviewMetadata,
  getBoardPreviewSource,
  type BoardPreviewMetadata,
} from "@/lib/boards/preview-repository";
import { renderBoardThumbnail } from "@/lib/boards/server/board-thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };
/** Bump when renderer output can change without a board generation/revision change. */
const THUMBNAIL_RENDER_CONTRACT_VERSION = 1;

const THUMBNAIL_HEADERS = {
  "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Content-Type": "image/png",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Surrogate-Control": "no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

function thumbnailEtag(metadata: BoardPreviewMetadata): string {
  const version = [
    String(THUMBNAIL_RENDER_CONTRACT_VERSION),
    metadata.boardId,
    metadata.workspaceId,
    metadata.documentGenerationId,
    String(metadata.revision),
  ].join("\0");
  return `"sha256-${createHash("sha256").update(version).digest("hex")}"`;
}

function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const value = request.headers.get("if-none-match");
  if (!value) return false;

  return value.split(",").some((candidate) => {
    const tag = candidate.trim();
    return tag === "*" || tag === etag || tag === `W/${etag}`;
  });
}

function requireSameOriginImageRequest(request: Request): void {
  if (request.headers.get("sec-fetch-site") !== "same-origin") {
    throw new BoardApiError(
      403,
      "forbidden_origin",
      "This request origin is not allowed.",
    );
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOriginImageRequest(request);
    const principal = await requirePrincipal();
    const boardId = UuidSchema.safeParse((await context.params).boardId);
    if (!boardId.success) throw invalidRequest();
    const metadata = await getBoardPreviewMetadata(principal.id, boardId.data);
    let etag = thumbnailEtag(metadata);
    const headers = new Headers(THUMBNAIL_HEADERS);
    headers.set("ETag", etag);
    if (matchesIfNoneMatch(request, etag)) {
      return new Response(null, { status: 304, headers });
    }

    const source = await getBoardPreviewSource(metadata);
    etag = thumbnailEtag(source);
    headers.set("ETag", etag);
    // The document can change between the lightweight version lookup and this
    // scoped read. Avoid Sharp if the resulting version matches after all.
    if (matchesIfNoneMatch(request, etag)) {
      return new Response(null, { status: 304, headers });
    }

    const thumbnail = await renderBoardThumbnail(source.document);
    headers.set("Content-Length", String(thumbnail.byteLength));
    return new Response(Uint8Array.from(thumbnail).buffer, { headers });
  } catch (error) {
    return handleApiError(error);
  }
}
