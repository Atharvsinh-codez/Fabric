import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  AddBoardMemberSchema,
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
import { addBoardMember, listBoardMembers } from "@/lib/boards/organization-repository";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

async function boardIdFrom(context: RouteContext): Promise<string> {
  const boardId = UuidSchema.safeParse((await context.params).boardId);
  if (!boardId.success) throw invalidRequest();
  return boardId.data;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const boardId = await boardIdFrom(context);
    await requireBoardWorkspaceRollout(principal.id, boardId);
    return apiJson({
      members: await listBoardMembers({
        userId: principal.id,
        boardId,
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
    const body = AddBoardMemberSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    const boardId = await boardIdFrom(context);
    await requireBoardWorkspaceRollout(principal.id, boardId);
    return apiJson(
      {
        member: await addBoardMember({
          actorId: principal.id,
          boardId,
          ...body.data,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
