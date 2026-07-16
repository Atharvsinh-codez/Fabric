import { requirePrincipal } from "@/lib/auth/require-principal";
import { BOARD_DOCUMENT_MAX_BYTES } from "@/lib/boards/contracts";
import {
  apiJson,
  handleApiError,
  invalidRequest,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { CompleteOnboardingSchema } from "@/lib/onboarding/contracts";
import { completeOnboarding } from "@/lib/onboarding/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const body = CompleteOnboardingSchema.safeParse(
      await readJsonBody(request, BOARD_DOCUMENT_MAX_BYTES + 16_384),
    );
    if (!body.success) throw invalidRequest();

    return apiJson(await completeOnboarding(principal.id, body.data), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
