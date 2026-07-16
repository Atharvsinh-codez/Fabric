import { AvatarUploadInitSchema } from "@/lib/account/avatar-contracts";
import { initiateAvatarUpload } from "@/lib/account/avatar-service";
import { requirePrincipal } from "@/lib/auth/require-principal";
import { DEFAULT_API_BODY_MAX_BYTES } from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { requireUserWorkspaceRollout } from "@/lib/rollout/workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = AvatarUploadInitSchema.safeParse(
      await readJsonBody(request, DEFAULT_API_BODY_MAX_BYTES),
    );
    if (!body.success) throw invalidRequest();
    await requireUserWorkspaceRollout(principal.id);
    return apiJson(
      await initiateAvatarUpload({ userId: principal.id, ...body.data }),
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
