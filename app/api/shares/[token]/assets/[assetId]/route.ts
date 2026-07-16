import { BoardAssetStorageIdSchema } from "@/lib/boards/assets/contracts";
import { getSharedBoardAsset } from "@/lib/boards/assets/repository";
import { createBoardAssetResponse } from "@/lib/boards/assets/response";
import { handleApiError, invalidRequest } from "@/lib/boards/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string; assetId: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const params = await context.params;
    const storageId = BoardAssetStorageIdSchema.safeParse(params.assetId);
    if (!storageId.success) throw invalidRequest();

    return await createBoardAssetResponse(
      await getSharedBoardAsset({
        shareToken: params.token,
        storageId: storageId.data,
      }),
      "share",
      request,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
