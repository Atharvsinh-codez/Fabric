import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateProjectSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { updateProject } from "@/lib/boards/organization-repository";
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
    const body = UpdateProjectSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!workspaceId.success || !projectId.success || !body.success) throw invalidRequest();
    await requireWorkspaceRolloutForUser(principal.id, workspaceId.data);
    return apiJson({
      project: await updateProject({
        userId: principal.id,
        workspaceId: workspaceId.data,
        projectId: projectId.data,
        ...body.data,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
