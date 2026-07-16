import { requirePrincipal } from "@/lib/auth/require-principal";
import { BoardAssetStorageIdSchema } from "@/lib/boards/assets/contracts";
import { getBoardAsset } from "@/lib/boards/assets/repository";
import { createBoardAssetResponse } from "@/lib/boards/assets/response";
import { UuidSchema } from "@/lib/boards/contracts";
import { handleApiError, invalidRequest } from "@/lib/boards/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string; assetId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const params = await context.params;
    const boardId = UuidSchema.safeParse(params.boardId);
    const storageId = BoardAssetStorageIdSchema.safeParse(params.assetId);
    if (!boardId.success || !storageId.success) throw invalidRequest();

    return await createBoardAssetResponse(
      await getBoardAsset({
        userId: principal.id,
        boardId: boardId.data,
        storageId: storageId.data,
      }),
      "member",
      request,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
