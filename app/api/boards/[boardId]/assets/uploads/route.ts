import { requirePrincipal } from "@/lib/auth/require-principal";
import { BoardAssetUploadInitSchema } from "@/lib/boards/assets/contracts";
import { initiateBoardAssetUpload } from "@/lib/boards/assets/r2-upload-service";
import { DEFAULT_API_BODY_MAX_BYTES, UuidSchema } from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = UuidSchema.safeParse((await context.params).boardId);
    const body = BoardAssetUploadInitSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!boardId.success || !body.success) throw invalidRequest();
    await requireBoardWorkspaceRollout(principal.id, boardId.data);

    return apiJson(
      await initiateBoardAssetUpload({
        userId: principal.id,
        boardId: boardId.data,
        tldrawAssetId: body.data.assetId,
        mimeType: body.data.mimeType,
        originalName: body.data.originalName,
        byteSize: body.data.byteSize,
        contentHash: body.data.contentHash,
      }),
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
