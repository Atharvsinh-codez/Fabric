import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  CreateProjectSchema,
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
import { createProject, listProjects } from "@/lib/boards/organization-repository";
import { requireWorkspaceRolloutForUser } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string }> };

async function workspaceIdFrom(context: RouteContext): Promise<string> {
  const workspaceId = UuidSchema.safeParse((await context.params).workspaceId);
  if (!workspaceId.success) throw invalidRequest();
  return workspaceId.data;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const workspaceId = await workspaceIdFrom(context);
    await requireWorkspaceRolloutForUser(principal.id, workspaceId);
    return apiJson({
      projects: await listProjects({
        userId: principal.id,
        workspaceId,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = CreateProjectSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    const workspaceId = await workspaceIdFrom(context);
    await requireWorkspaceRolloutForUser(principal.id, workspaceId);
    return apiJson(
      {
        project: await createProject({
          userId: principal.id,
          workspaceId,
          ...body.data,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
