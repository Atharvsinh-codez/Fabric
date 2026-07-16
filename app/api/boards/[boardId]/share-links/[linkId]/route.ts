import { requirePrincipal } from "@/lib/auth/require-principal";
import { UuidSchema } from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  requireSameOrigin,
} from "@/lib/boards/http";
import { revokeShareLink } from "@/lib/boards/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string; linkId: string }> };

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const params = await context.params;
    const boardId = UuidSchema.safeParse(params.boardId);
    const linkId = UuidSchema.safeParse(params.linkId);
    if (!boardId.success || !linkId.success) throw invalidRequest();
    return apiJson({
      link: await revokeShareLink({
        userId: principal.id,
        boardId: boardId.data,
        linkId: linkId.data,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
