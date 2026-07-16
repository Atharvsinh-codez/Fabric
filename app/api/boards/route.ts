import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  BOARD_DOCUMENT_MAX_BYTES,
  CreateBoardSchema,
  ListBoardsQuerySchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { createBoard, listBoardsPage } from "@/lib/boards/repository";
import { requireWorkspaceRolloutForUser } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const url = new URL(request.url);
    const query = ListBoardsQuerySchema.safeParse({
      workspaceId: url.searchParams.get("workspaceId"),
      view: url.searchParams.get("view") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!query.success) throw invalidRequest();
    if (
      query.data.view !== "recent" ||
      query.data.q !== undefined ||
      query.data.projectId !== undefined ||
      query.data.status !== undefined
    ) {
      await requireWorkspaceRolloutForUser(
        principal.id,
        query.data.workspaceId,
      );
    }
    return apiJson(
      await listBoardsPage({ userId: principal.id, ...query.data }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const result = CreateBoardSchema.safeParse(
      await readJsonBody(request, BOARD_DOCUMENT_MAX_BYTES + 8_192),
    );
    if (!result.success) throw invalidRequest();
    if (
      result.data.projectId !== undefined ||
      result.data.sharingPolicy !== undefined ||
      result.data.cover !== undefined
    ) {
      await requireWorkspaceRolloutForUser(
        principal.id,
        result.data.workspaceId,
      );
    }
    const board = await createBoard({ userId: principal.id, ...result.data });
    return apiJson({ board }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
