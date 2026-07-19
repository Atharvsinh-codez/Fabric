import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  DeleteBoardSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { deleteBoard } from "@/lib/boards/repository";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = UuidSchema.safeParse((await context.params).boardId);
    const body = DeleteBoardSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!boardId.success || !body.success) throw invalidRequest();

    await requireBoardWorkspaceRollout(principal.id, boardId.data);
    const deleted = await deleteBoard({
      userId: principal.id,
      boardId: boardId.data,
      ...body.data,
    });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ deleted });
  } catch (error) {
    return handleApiError(error);
  }
}
