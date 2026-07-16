import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  AddProjectMemberSchema,
  DEFAULT_API_BODY_MAX_BYTES,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import {
  addProjectMember,
  listProjectMembers,
} from "@/lib/boards/organization-repository";
import { requireWorkspaceRolloutForUser } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string; projectId: string }> };

async function idsFrom(context: RouteContext) {
  const params = await context.params;
  const workspaceId = UuidSchema.safeParse(params.workspaceId);
  const projectId = UuidSchema.safeParse(params.projectId);
  if (!workspaceId.success || !projectId.success) throw invalidRequest();
  return { workspaceId: workspaceId.data, projectId: projectId.data };
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const ids = await idsFrom(context);
    await requireWorkspaceRolloutForUser(principal.id, ids.workspaceId);
    return apiJson({
      members: await listProjectMembers({ userId: principal.id, ...ids }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = AddProjectMemberSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    const ids = await idsFrom(context);
    await requireWorkspaceRolloutForUser(principal.id, ids.workspaceId);
    return apiJson(
      {
        member: await addProjectMember({
          actorId: principal.id,
          ...ids,
          ...body.data,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
