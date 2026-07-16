import { AvatarUploadIdSchema } from "@/lib/account/avatar-contracts";
import { finalizeAvatarUpload } from "@/lib/account/avatar-service";
import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  requireSameOrigin,
} from "@/lib/boards/http";
import { requireUserWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uploadId: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const uploadId = AvatarUploadIdSchema.safeParse((await context.params).uploadId);
    if (!uploadId.success) throw invalidRequest();
    await requireUserWorkspaceRollout(principal.id);
    return apiJson(
      await finalizeAvatarUpload({ userId: principal.id, uploadId: uploadId.data }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
