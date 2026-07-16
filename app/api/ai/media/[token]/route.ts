import { and, eq, gt, inArray, isNull } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { aiRuns, type AiRunStatus } from "@/db/schema/ai";
import { boardAssets } from "@/db/schema/assets";
import { boards } from "@/db/schema/product";
import {
  AiMediaTokenError,
  deriveAiMediaSigningKey,
  verifyAiMediaToken,
} from "@/lib/ai/media-token";
import { AiProposalRequestSchema } from "@/lib/ai/proposal-request";
import { renderAiSelectionPreview } from "@/lib/ai/server/selection-preview";
import { createBoardAssetResponse } from "@/lib/boards/assets/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AI_MEDIA_RUN_STATUSES = [
  "queued",
  "preparing_context",
  "calling_model",
  "building_proposal",
  "validating_proposal",
  "waiting_for_approval",
  "applying",
] as const satisfies readonly AiRunStatus[];

type RouteContext = { params: Promise<{ token: string }> };

function unavailableResponse(): Response {
  return new Response(null, {
    status: 503,
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "Retry-After": "30",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function notFoundResponse(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function selectionPreviewResponse(bytes: Uint8Array): Response {
  return new Response(Uint8Array.from(bytes).buffer, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
      "Content-Length": String(bytes.byteLength),
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Type": "image/png",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Referrer-Policy": "no-referrer",
      "Surrogate-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || new TextEncoder().encode(authSecret).byteLength < 32) {
    return unavailableResponse();
  }
  const signingKey = deriveAiMediaSigningKey(authSecret);

  try {
    const { token } = await context.params;
    const now = new Date();
    const claim = await verifyAiMediaToken(token, { signingKey, now });
    const [run] = await db
      .select({
        boardId: aiRuns.boardId,
        executionInput: aiRuns.executionInput,
      })
      .from(aiRuns)
      .innerJoin(boards, eq(boards.id, aiRuns.boardId))
      .where(
        and(
          eq(aiRuns.id, claim.runId),
          eq(aiRuns.boardId, claim.boardId),
          inArray(aiRuns.status, [...AI_MEDIA_RUN_STATUSES]),
          isNull(aiRuns.cancelRequestedAt),
          gt(aiRuns.deadlineAt, now),
          isNull(boards.archivedAt),
        ),
      )
      .limit(1);
    if (!run) return notFoundResponse();

    if (claim.kind === "board-asset") {
      const [asset] = await db
        .select({
          id: boardAssets.id,
          mimeType: boardAssets.mimeType,
          byteSize: boardAssets.byteSize,
          contentHash: boardAssets.contentHash,
          content: boardAssets.content,
          storageState: boardAssets.storageState,
          r2ObjectKey: boardAssets.r2ObjectKey,
        })
        .from(boardAssets)
        .where(
          and(
            eq(boardAssets.id, claim.assetId),
            eq(boardAssets.boardId, claim.boardId),
            eq(boardAssets.contentHash, claim.contentHash),
            inArray(boardAssets.storageState, ["postgres_only", "r2_ready"]),
          ),
        )
        .limit(1);
      return asset
        ? await createBoardAssetResponse(asset, "ai", request)
        : notFoundResponse();
    }

    const executionInput = AiProposalRequestSchema.safeParse(run.executionInput);
    if (
      !executionInput.success ||
      executionInput.data.boardId !== claim.boardId
    ) {
      return notFoundResponse();
    }
    return selectionPreviewResponse(
      await renderAiSelectionPreview(executionInput.data.selection),
    );
  } catch (error) {
    return error instanceof AiMediaTokenError && error.code === "configuration"
      ? unavailableResponse()
      : notFoundResponse();
  }
}
