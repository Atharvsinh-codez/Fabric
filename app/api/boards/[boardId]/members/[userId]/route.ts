import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateBoardMemberSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { updateBoardMember } from "@/lib/boards/organization-repository";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string; userId: string }> };

async function idsFrom(context: RouteContext) {
  const params = await context.params;
  const boardId = UuidSchema.safeParse(params.boardId);
  const userId = UuidSchema.safeParse(params.userId);
  if (!boardId.success || !userId.success) throw invalidRequest();
  return { boardId: boardId.data, userId: userId.data };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = UpdateBoardMemberSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    const ids = await idsFrom(context);
    await requireBoardWorkspaceRollout(principal.id, ids.boardId);
    const member = await updateBoardMember({
        actorId: principal.id,
        ...ids,
        role: body.data.role,
      });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ member });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const ids = await idsFrom(context);
    await requireBoardWorkspaceRollout(principal.id, ids.boardId);
    const member = await updateBoardMember({
        actorId: principal.id,
        ...ids,
        remove: true,
      });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ member });
  } catch (error) {
    return handleApiError(error);
  }
}
