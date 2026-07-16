import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateProjectPreferenceSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { updateProjectPreference } from "@/lib/boards/organization-repository";
import { requireWorkspaceRolloutForUser } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string; projectId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const params = await context.params;
    const workspaceId = UuidSchema.safeParse(params.workspaceId);
    const projectId = UuidSchema.safeParse(params.projectId);
    const body = UpdateProjectPreferenceSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!workspaceId.success || !projectId.success || !body.success) throw invalidRequest();
    await requireWorkspaceRolloutForUser(principal.id, workspaceId.data);
    return apiJson({
      preference: await updateProjectPreference({
        userId: principal.id,
        workspaceId: workspaceId.data,
        projectId: projectId.data,
        pinned: body.data.pinned,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
