import { z } from "zod";

import { requirePrincipal } from "@/lib/auth/require-principal";
import { listWorkspaceActivity } from "@/lib/boards/activity";
import { UuidSchema } from "@/lib/boards/contracts";
import { apiJson, handleApiError, invalidRequest } from "@/lib/boards/http";
import { PAGINATION_CURSOR_MAX_CHARS } from "@/lib/boards/pagination-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ workspaceId: string }> };

const ActivityQuerySchema = z.object({
  cursor: z.string().min(1).max(PAGINATION_CURSOR_MAX_CHARS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    const workspaceId = UuidSchema.safeParse((await context.params).workspaceId);
    const url = new URL(request.url);
    const query = ActivityQuerySchema.safeParse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!workspaceId.success || !query.success) throw invalidRequest();

    return apiJson({
      activity: await listWorkspaceActivity({
        userId: principal.id,
        workspaceId: workspaceId.data,
        cursor: query.data.cursor,
        limit: query.data.limit,
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
