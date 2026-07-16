import { requirePrincipal } from "@/lib/auth/require-principal";
import { UuidSchema } from "@/lib/boards/contracts";
import { apiJson, handleApiError, invalidRequest, requireSameOrigin } from "@/lib/boards/http";
import { restoreBoard } from "@/lib/boards/repository";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = UuidSchema.safeParse((await context.params).boardId);
    if (!boardId.success) throw invalidRequest();
    await requireBoardWorkspaceRollout(principal.id, boardId.data);
    return apiJson({ board: await restoreBoard({ userId: principal.id, boardId: boardId.data }) });
  } catch (error) {
    return handleApiError(error);
  }
}
