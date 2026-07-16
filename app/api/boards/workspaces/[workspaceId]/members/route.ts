import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  AddWorkspaceMemberSchema,
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
import { addWorkspaceMember, listWorkspaceMembers } from "@/lib/boards/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string }> };

async function parseWorkspaceId(context: RouteContext): Promise<string> {
  const result = UuidSchema.safeParse((await context.params).workspaceId);
  if (!result.success) throw invalidRequest();
  return result.data;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    return apiJson({
      members: await listWorkspaceMembers(principal.id, await parseWorkspaceId(context)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = AddWorkspaceMemberSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    return apiJson(
      {
        member: await addWorkspaceMember({
          actorId: principal.id,
          workspaceId: await parseWorkspaceId(context),
          ...body.data,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
