import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  ResolveCommentThreadSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { setCommentThreadResolution } from "@/lib/boards/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string; threadId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const params = await context.params;
    const boardId = UuidSchema.safeParse(params.boardId);
    const threadId = UuidSchema.safeParse(params.threadId);
    const body = ResolveCommentThreadSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!boardId.success || !threadId.success || !body.success) throw invalidRequest();
    return apiJson({
      thread: await setCommentThreadResolution({
        userId: principal.id,
        boardId: boardId.data,
        threadId: threadId.data,
        resolved: body.data.resolved,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
