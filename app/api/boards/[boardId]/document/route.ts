import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  BOARD_DOCUMENT_MAX_BYTES,
  UpdateBoardDocumentSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { updateBoardDocument } from "@/lib/boards/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = UuidSchema.safeParse((await context.params).boardId);
    const body = UpdateBoardDocumentSchema.safeParse(
      await readJsonBody(request, BOARD_DOCUMENT_MAX_BYTES + 8_192),
    );
    if (!boardId.success || !body.success) throw invalidRequest();
    return apiJson({
      board: await updateBoardDocument({
        userId: principal.id,
        boardId: boardId.data,
        ...body.data,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
