import { requirePrincipal } from "@/lib/auth/require-principal";
import { BoardAssetUploadIdSchema } from "@/lib/boards/assets/contracts";
import { finalizeBoardAssetUpload } from "@/lib/boards/assets/r2-upload-service";
import { UuidSchema } from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  requireSameOrigin,
} from "@/lib/boards/http";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string; uploadId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const params = await context.params;
    const boardId = UuidSchema.safeParse(params.boardId);
    const uploadId = BoardAssetUploadIdSchema.safeParse(params.uploadId);
    if (!boardId.success || !uploadId.success) throw invalidRequest();
    await requireBoardWorkspaceRollout(principal.id, boardId.data);

    return apiJson(
      await finalizeBoardAssetUpload({
        userId: principal.id,
        boardId: boardId.data,
        uploadId: uploadId.data,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
