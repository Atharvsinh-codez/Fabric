import { requirePrincipal } from "@/lib/auth/require-principal";
import { CreateWorkspaceSchema, DEFAULT_API_BODY_MAX_BYTES } from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { createWorkspace, listWorkspaces } from "@/lib/boards/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    return apiJson({ workspaces: await listWorkspaces(principal.id) });
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const result = CreateWorkspaceSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!result.success) throw invalidRequest();
    return apiJson(
      { workspace: await createWorkspace(principal.id, result.data.name) },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
