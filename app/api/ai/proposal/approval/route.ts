import { requirePrincipal } from "@/lib/auth/require-principal";
import { AiProposalApprovalRequestSchema } from "@/lib/ai/approval";
import { finalizeAiProposalApproval } from "@/lib/ai/server/approval-repository";
import {
  apiJson,
  BoardApiError,
  handleApiError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_APPROVAL_BYTES = 2 * 1_024;

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const parsed = AiProposalApprovalRequestSchema.safeParse(
      await readJsonBody(request, MAX_APPROVAL_BYTES),
    );
    if (!parsed.success) {
      throw new BoardApiError(
        422,
        "invalid_approval",
        "The AI proposal approval failed validation.",
      );
    }
    return apiJson(await finalizeAiProposalApproval(principal.id, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}
