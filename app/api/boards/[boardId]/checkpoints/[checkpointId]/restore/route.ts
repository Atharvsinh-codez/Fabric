import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  DEFAULT_API_BODY_MAX_BYTES,
  RestoreBoardCheckpointSchema,
  UuidSchema,
} from "@/lib/boards/contracts";
import { restoreBoardCheckpoint } from "@/lib/boards/checkpoint-repository";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { scheduleRealtimeRevocationDispatch } from "@/lib/realtime/schedule-revocation-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ boardId: string; checkpointId: string }>;
};

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const params = await context.params;
    const boardId = UuidSchema.safeParse(params.boardId);
    const checkpointId = UuidSchema.safeParse(params.checkpointId);
    const body = RestoreBoardCheckpointSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!boardId.success || !checkpointId.success || !body.success) throw invalidRequest();

    const board = await restoreBoardCheckpoint({
        userId: principal.id,
        boardId: boardId.data,
        checkpointId: checkpointId.data,
      });
    scheduleRealtimeRevocationDispatch();
    return apiJson({ board });
  } catch (error) {
    return handleApiError(error);
  }
}
