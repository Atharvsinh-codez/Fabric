import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  CreateCommentSchema,
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
import {
  createCommentThread,
  listCommentThreads,
  replyToCommentThread,
} from "@/lib/boards/repository";

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
      threads: await listCommentThreads(principal.id, await parseBoardId(context)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const boardId = await parseBoardId(context);
    const result = CreateCommentSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!result.success) throw invalidRequest();
    const comment =
      result.data.kind === "thread"
        ? await createCommentThread({ userId: principal.id, boardId, ...result.data })
        : await replyToCommentThread({ userId: principal.id, boardId, ...result.data });
    return apiJson({ comment }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
