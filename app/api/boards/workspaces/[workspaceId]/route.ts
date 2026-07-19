import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  DeleteWorkspaceSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { deleteWorkspace } from "@/lib/boards/repository";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";
import { requireWorkspaceRolloutForUser } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string }> };

export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const workspaceId = UuidSchema.safeParse((await context.params).workspaceId);
    const body = DeleteWorkspaceSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!workspaceId.success || !body.success) throw invalidRequest();

    await requireWorkspaceRolloutForUser(principal.id, workspaceId.data);
    const deleted = await deleteWorkspace({
      userId: principal.id,
      workspaceId: workspaceId.data,
      ...body.data,
    });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ deleted });
  } catch (error) {
    return handleApiError(error);
  }
}
