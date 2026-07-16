import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  CreateShareLinkSchema,
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
import { createShareLink, listShareLinks } from "@/lib/boards/repository";

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
      links: await listShareLinks(principal.id, await parseBoardId(context)),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = CreateShareLinkSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    return apiJson(
      {
        link: await createShareLink({
          userId: principal.id,
          boardId: await parseBoardId(context),
          permission: body.data.permission,
          expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
        }),
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
