import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { aiRunEvents, aiRuns } from "@/db/schema/ai";
import {
  boardMemberships,
  boards,
  projectMemberships,
  workspaceMemberships,
} from "@/db/schema/product";
import {
  type AiProposalApprovalRequest,
  type AiProposalApprovalResult,
  verifyApprovedPatchProjection,
} from "@/lib/ai/approval";
import { CanvasPatchSchema } from "@/lib/ai/canvas-patch";
import { hashCanonicalJson } from "@/lib/ai/hash";
import { effectiveBoardAccess } from "@/lib/boards/access-policy";
import { readCanvasDocument } from "@/lib/boards/canvas-document";
import { BoardApiError } from "@/lib/boards/http";
import { roleCan } from "@/lib/boards/permissions";

const APPROVAL_WINDOW_MS = 15 * 60 * 1_000;

type DeferredFailure = Readonly<{
  error: BoardApiError;
}>;

function deferredError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DeferredFailure {
  return { error: new BoardApiError(status, code, message, details) };
}

export async function finalizeAiProposalApproval(
  principalId: string,
  input: AiProposalApprovalRequest,
  now = new Date(),
): Promise<AiProposalApprovalResult> {
  const outcome = await db.transaction(async (transaction) => {
    const [run] = await transaction
      .select({
        id: aiRuns.id,
        status: aiRuns.status,
        workspaceId: aiRuns.workspaceId,
        boardId: aiRuns.boardId,
        documentGenerationId: aiRuns.documentGenerationId,
        baseDurableSequence: aiRuns.baseDurableSequence,
        proposal: aiRuns.proposal,
        proposalHash: aiRuns.proposalHash,
        usage: aiRuns.usage,
        lastEventSequence: aiRuns.lastEventSequence,
        proposalReadyAt: aiRuns.updatedAt,
      })
      .from(aiRuns)
      .where(and(eq(aiRuns.id, input.runId), eq(aiRuns.principalId, principalId)))
      .for("update")
      .limit(1);

    if (!run) {
      throw new BoardApiError(404, "not_found", "The requested AI run was not found.");
    }
    if (run.status === "completed") {
      throw new BoardApiError(
        409,
        "approval_replayed",
        "This AI proposal was already finalized.",
      );
    }
    if (run.status === "applying") {
      throw new BoardApiError(
        409,
        "approval_in_progress",
        "This AI proposal is already being finalized.",
      );
    }
    if (run.status !== "waiting_for_approval") {
      throw new BoardApiError(
        409,
        "run_not_approvable",
        "This AI run no longer has a proposal that can be approved.",
      );
    }

    if (
      input.patchHash !== run.proposalHash ||
      input.documentGenerationId !== run.documentGenerationId ||
      input.baseDurableSequence !== run.baseDurableSequence
    ) {
      throw new BoardApiError(
        409,
        "approval_binding_mismatch",
        "The approval does not match the stored AI proposal and board base.",
      );
    }

    const parsedPatch = CanvasPatchSchema.safeParse(run.proposal);
    if (
      !parsedPatch.success ||
      hashCanonicalJson(parsedPatch.data) !== run.proposalHash ||
      parsedPatch.data.base.workspaceId !== run.workspaceId ||
      parsedPatch.data.base.boardId !== run.boardId ||
      parsedPatch.data.base.documentGenerationId !== run.documentGenerationId ||
      parsedPatch.data.base.durableSequence !== run.baseDurableSequence
    ) {
      throw new BoardApiError(
        500,
        "proposal_integrity_failed",
        "The stored AI proposal could not be verified.",
      );
    }

    if (now.getTime() - run.proposalReadyAt.getTime() > APPROVAL_WINDOW_MS) {
      const nextSequence = run.lastEventSequence + 1;
      await transaction
        .update(aiRuns)
        .set({
          status: "expired_approval",
          finishedAt: now,
          lastEventSequence: nextSequence,
          updatedAt: now,
        })
        .where(eq(aiRuns.id, run.id));
      await transaction.insert(aiRunEvents).values({
        runId: run.id,
        sequence: nextSequence,
        type: "run.error",
        payload: {
          code: "expired_approval",
          message: "The AI proposal approval window expired.",
          retryable: false,
        },
        createdAt: now,
      });
      return deferredError(
        409,
        "expired_approval",
        "This AI proposal expired. Generate a fresh proposal before applying it.",
      );
    }

    const [board] = await transaction
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        document: boards.document,
        documentGenerationId: boards.documentGenerationId,
        revision: boards.revision,
        ownerId: boards.ownerId,
        sharingPolicy: boards.sharingPolicy,
        archivedAt: boards.archivedAt,
        workspaceRole: workspaceMemberships.role,
        directRole: boardMemberships.role,
        projectRole: projectMemberships.role,
      })
      .from(boards)
      .leftJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, boards.workspaceId),
          eq(workspaceMemberships.userId, principalId),
        ),
      )
      .leftJoin(
        boardMemberships,
        and(
          eq(boardMemberships.boardId, boards.id),
          eq(boardMemberships.workspaceId, boards.workspaceId),
          eq(boardMemberships.userId, principalId),
        ),
      )
      .leftJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, boards.projectId),
          eq(projectMemberships.workspaceId, boards.workspaceId),
          eq(projectMemberships.userId, principalId),
        ),
      )
      .where(and(eq(boards.id, run.boardId), isNull(boards.archivedAt)))
      .for("update")
      .limit(1);

    const access = board
      ? effectiveBoardAccess({
          userId: principalId,
          workspaceId: board.workspaceId,
          ownerId: board.ownerId,
          sharingPolicy: board.sharingPolicy,
          archivedAt: board.archivedAt,
          workspaceRole: board.workspaceRole,
          directRole: board.directRole,
          projectRole: board.projectRole,
        })
      : null;
    if (
      !board ||
      board.workspaceId !== run.workspaceId ||
      !access ||
      !roleCan(access.role, "edit_board")
    ) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }

    if (board.documentGenerationId !== run.documentGenerationId) {
      const nextSequence = run.lastEventSequence + 1;
      await transaction
        .update(aiRuns)
        .set({
          status: "stale_generation",
          finishedAt: now,
          lastEventSequence: nextSequence,
          updatedAt: now,
        })
        .where(eq(aiRuns.id, run.id));
      await transaction.insert(aiRunEvents).values({
        runId: run.id,
        sequence: nextSequence,
        type: "run.error",
        payload: {
          code: "stale_generation",
          message: "The board document generation changed before approval.",
          retryable: false,
        },
        createdAt: now,
      });
      return deferredError(
        409,
        "stale_generation",
        "The board document was replaced. Generate a fresh proposal.",
      );
    }

    const appliedDurableSequence = board.revision;

    // Equality with the signed base is valid only when the exact projection
    // below already satisfies the approved patch (an intentional no-op). This
    // avoids a 30-second client wait for already-arranged/styled content while
    // still rejecting every unsaved mutation through projection verification.
    if (
      input.observedDurableSequence !== appliedDurableSequence ||
      appliedDurableSequence < run.baseDurableSequence
    ) {
      throw new BoardApiError(
        409,
        "approval_not_durable",
        "Wait for the approved board change to finish saving, then try again.",
        {
          currentDurableSequence: appliedDurableSequence,
        },
      );
    }

    const projection = verifyApprovedPatchProjection(
      parsedPatch.data,
      readCanvasDocument(board.document),
    );
    if (!projection.ok) {
      throw new BoardApiError(
        409,
        "approval_not_durable",
        "The stored board does not yet contain the exact approved AI changes.",
        { issueCodes: projection.issueCodes },
      );
    }

    // Both transitions happen under the same transaction and locked run. No
    // observer can claim a completed run before the durable projection check.
    await transaction
      .update(aiRuns)
      .set({ status: "applying", updatedAt: now })
      .where(and(eq(aiRuns.id, run.id), eq(aiRuns.status, "waiting_for_approval")));
    const nextSequence = run.lastEventSequence + 1;
    await transaction
      .update(aiRuns)
      .set({
        status: "completed",
        finishedAt: now,
        lastEventSequence: nextSequence,
        updatedAt: now,
      })
      .where(and(eq(aiRuns.id, run.id), eq(aiRuns.status, "applying")));
    await transaction.insert(aiRunEvents).values({
      runId: run.id,
      sequence: nextSequence,
      type: "run.completed",
      payload: { usage: run.usage },
      createdAt: now,
    });

    return {
      run: {
        id: run.id,
        status: "completed" as const,
        boardId: board.id,
        documentGenerationId: board.documentGenerationId,
        baseDurableSequence: run.baseDurableSequence,
        appliedDurableSequence,
        finalizedAt: now.toISOString(),
      },
    } satisfies AiProposalApprovalResult;
  });

  if ("error" in outcome) throw outcome.error;
  return outcome;
}
