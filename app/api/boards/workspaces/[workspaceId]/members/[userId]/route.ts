import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateWorkspaceMemberSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { removeWorkspaceMember, updateWorkspaceMember } from "@/lib/boards/repository";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string; userId: string }> };

async function parseIds(context: RouteContext): Promise<{ workspaceId: string; userId: string }> {
  const params = await context.params;
  const workspaceId = UuidSchema.safeParse(params.workspaceId);
  const userId = UuidSchema.safeParse(params.userId);
  if (!workspaceId.success || !userId.success) throw invalidRequest();
  return { workspaceId: workspaceId.data, userId: userId.data };
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = UpdateWorkspaceMemberSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    const member = await updateWorkspaceMember({
        actorId: principal.id,
        ...(await parseIds(context)),
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
    const member = await removeWorkspaceMember({
        actorId: principal.id,
        ...(await parseIds(context)),
      });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ member });
  } catch (error) {
    return handleApiError(error);
  }
}
