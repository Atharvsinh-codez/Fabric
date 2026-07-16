import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  BOARD_ASSET_IMAGE_MAX_BYTES,
  DeleteBoardAssetsSchema,
  TldrawAssetIdSchema,
  boardAssetSource,
  declaredMimeMatchesDetected,
  decodeAssetFileName,
  detectBoardAssetMimeType,
} from "@/lib/boards/assets/contracts";
import { readBoundedBinaryBody } from "@/lib/boards/assets/binary-body";
import {
  deleteBoardAssets,
  listBoardImageAssets,
  storeBoardAsset,
} from "@/lib/boards/assets/repository";
import { DEFAULT_API_BODY_MAX_BYTES, UuidSchema } from "@/lib/boards/contracts";
import {
  BoardApiError,
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

async function parseBoardId(context: RouteContext): Promise<string> {
  const parsed = UuidSchema.safeParse((await context.params).boardId);
  if (!parsed.success) throw invalidRequest();
  return parsed.data;
}

export async function GET(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    return apiJson({
      assets: await listBoardImageAssets({
        userId: principal.id,
        boardId: await parseBoardId(context),
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = await parseBoardId(context);
    const tldrawAssetId = TldrawAssetIdSchema.safeParse(
      new URL(request.url).searchParams.get("assetId"),
    );
    if (!tldrawAssetId.success) throw invalidRequest();

    // Transitional server-mediated upload for existing image clients. New
    // image/video clients use the R2 init -> direct PUT -> finalize flow.
    const content = await readBoundedBinaryBody(
      request,
      BOARD_ASSET_IMAGE_MAX_BYTES,
    );
    const mimeType = detectBoardAssetMimeType(content);
    if (
      !mimeType ||
      !mimeType.startsWith("image/") ||
      !declaredMimeMatchesDetected(
        request.headers.get("content-type"),
        mimeType,
      )
    ) {
      throw new BoardApiError(
        415,
        "unsupported_asset_type",
        "Upload a valid PNG, JPEG, GIF, or WebP image.",
      );
    }

    const stored = await storeBoardAsset({
      userId: principal.id,
      boardId,
      tldrawAssetId: tldrawAssetId.data,
      mimeType,
      originalName: decodeAssetFileName(
        request.headers.get("x-fabric-asset-name"),
      ),
      content,
    });
    return apiJson(
      {
        asset: {
          id: stored.id,
          tldrawAssetId: stored.tldrawAssetId,
          src: boardAssetSource(boardId, stored.id),
          mimeType: stored.mimeType,
          byteSize: stored.byteSize,
          contentHash: stored.contentHash,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = await parseBoardId(context);
    const body = DeleteBoardAssetsSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();

    return apiJson(
      await deleteBoardAssets({
        userId: principal.id,
        boardId,
        tldrawAssetIds: body.data.assetIds,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
