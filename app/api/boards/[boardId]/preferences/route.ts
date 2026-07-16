import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  UpdateBoardPreferenceSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { updateBoardPreference } from "@/lib/boards/repository";
import { requireBoardWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = UuidSchema.safeParse((await context.params).boardId);
    const body = UpdateBoardPreferenceSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!boardId.success || !body.success) throw invalidRequest();
    await requireBoardWorkspaceRollout(principal.id, boardId.data);
    return apiJson({
      preference: await updateBoardPreference({
        userId: principal.id,
        boardId: boardId.data,
        ...body.data,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
