import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  CreateCommentSchema,
  DEFAULT_API_BODY_MAX_BYTES,
  PublicShareTokenSchema,
} from "@/lib/boards/contracts";
import {
  apiJson,
  BoardApiError,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import {
  createPublicShareComment,
  listPublicShareCommentThreads,
} from "@/lib/boards/public-share-comments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ token: string }> };

async function parseToken(context: RouteContext): Promise<string> {
  const parsed = PublicShareTokenSchema.safeParse((await context.params).token);
  if (!parsed.success) {
    throw new BoardApiError(404, "not_found", "This shared board is unavailable.");
  }
  return parsed.data;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const result = await listPublicShareCommentThreads(await parseToken(context));
    return apiJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const token = await parseToken(context);
    const principal = await requirePrincipal();
    const body = CreateCommentSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();

    return apiJson(
      {
        comment: await createPublicShareComment({
          token,
          userId: principal.id,
          comment: body.data,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
