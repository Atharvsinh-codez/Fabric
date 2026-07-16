import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateProjectMemberSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { updateProjectMember } from "@/lib/boards/organization-repository";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";
import { requireWorkspaceRolloutForUser } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ workspaceId: string; projectId: string; userId: string }>;
};

async function idsFrom(context: RouteContext) {
  const params = await context.params;
  const workspaceId = UuidSchema.safeParse(params.workspaceId);
  const projectId = UuidSchema.safeParse(params.projectId);
  const userId = UuidSchema.safeParse(params.userId);
  if (!workspaceId.success || !projectId.success || !userId.success) throw invalidRequest();
  return { workspaceId: workspaceId.data, projectId: projectId.data, userId: userId.data };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = UpdateProjectMemberSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    const ids = await idsFrom(context);
    await requireWorkspaceRolloutForUser(principal.id, ids.workspaceId);
    const member = await updateProjectMember({
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
    await requireWorkspaceRolloutForUser(principal.id, ids.workspaceId);
    const member = await updateProjectMember({
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
