import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  CreateBoardCheckpointSchema,
  DEFAULT_API_BODY_MAX_BYTES,
  UuidSchema,
} from "@/lib/boards/contracts";
import {
  createBoardCheckpoint,
  listBoardCheckpoints,
} from "@/lib/boards/checkpoint-repository";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ boardId: string }> };

async function parseBoardId(context: RouteContext): Promise<string> {
  const result = UuidSchema.safeParse((await context.params).boardId);
  if (!result.success) throw invalidRequest();
  return result.data;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    return apiJson({
      checkpoints: await listBoardCheckpoints(principal.id, await parseBoardId(context)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = CreateBoardCheckpointSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();

    return apiJson(
      {
        checkpoint: await createBoardCheckpoint({
          userId: principal.id,
          boardId: await parseBoardId(context),
          name: body.data.name,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
