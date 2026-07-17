import { createHash } from "node:crypto";

import { requirePrincipal } from "@/lib/auth/require-principal";
import { UuidSchema } from "@/lib/boards/contracts";
import { BoardApiError, handleApiError, invalidRequest } from "@/lib/boards/http";
import { getBoardPreviewSource } from "@/lib/boards/preview-repository";
import { renderBoardThumbnail } from "@/lib/boards/server/board-thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

const THUMBNAIL_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Content-Type": "image/png",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "Surrogate-Control": "no-store",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
} as const;

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
    const source = await getBoardPreviewSource(principal.id, boardId.data);
    const thumbnail = await renderBoardThumbnail(source.document);
    const headers = new Headers(THUMBNAIL_HEADERS);
    headers.set("Content-Length", String(thumbnail.byteLength));
    headers.set(
      "ETag",
      `"sha256-${createHash("sha256").update(thumbnail).digest("hex")}"`,
    );
    return new Response(Uint8Array.from(thumbnail).buffer, { headers });
  } catch (error) {
    return handleApiError(error);
  }
}
