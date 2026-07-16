import { requirePrincipal } from "@/lib/auth/require-principal";
import {
  clearAccountAvatar,
  getAccountAvatar,
} from "@/lib/account/avatar-service";
import {
  apiJson,
  handleApiError,
  requireSameOrigin,
} from "@/lib/boards/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    return apiJson(await getAccountAvatar(principal.id));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    return apiJson(await clearAccountAvatar(principal.id));
  } catch (error) {
    return handleApiError(error);
  }
}
