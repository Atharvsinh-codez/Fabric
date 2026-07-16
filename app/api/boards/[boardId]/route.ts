import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateBoardMetadataSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { archiveBoard, getBoard, updateBoardMetadata } from "@/lib/boards/repository";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

async function boardIdFrom(context: RouteContext): Promise<string> {
  const result = UuidSchema.safeParse((await context.params).boardId);
  if (!result.success) throw invalidRequest();
  return result.data;
}
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    return apiJson({ board: await getBoard(principal.id, await boardIdFrom(context)) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const result = UpdateBoardMetadataSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!result.success) throw invalidRequest();
    const boardId = await boardIdFrom(context);
    if (
      result.data.projectId !== undefined ||
      result.data.ownerId !== undefined ||
      result.data.status !== undefined ||
      result.data.sharingPolicy !== undefined ||
      result.data.cover !== undefined
    ) {
      await requireBoardWorkspaceRollout(principal.id, boardId);
    }
    const board = await updateBoardMetadata({
        userId: principal.id,
        boardId,
        ...result.data,
      });
    if (
      result.data.ownerId !== undefined ||
      result.data.projectId !== undefined ||
      result.data.sharingPolicy !== undefined
    ) {
      scheduleRealtimeRevocationDispatch();
    }
    return apiJson({ board });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = await boardIdFrom(context);
    await requireBoardWorkspaceRollout(principal.id, boardId);
    const board = await archiveBoard({
        userId: principal.id,
        boardId,
      });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ board });
  } catch (error) {
    return handleApiError(error);
  }
}
