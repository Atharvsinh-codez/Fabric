import "server-only";

import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { aiJobs, aiRunEvents, aiRuns, type AiRunStatus } from "@/db/schema/ai";
import { boards } from "@/db/schema/product";
import { hashCanonicalJson } from "@/lib/ai/hash";
import { buildAuthorizedBoardScene } from "@/lib/ai/engine/authorized-scene";
import {
  hashIdempotencyKey,
  resolveIdempotentRun,
} from "@/lib/ai/idempotency";
import { loadAiRunProvenance } from "@/lib/ai/config";
import {
  type AiProposalRequest,
  ProposalNodeSnapshotSchema,
} from "@/lib/ai/proposal-request";
import { isTerminalAiRunStatus } from "@/lib/ai/run-state";
import { getBoardAssistanceSkill } from "@/lib/ai/skills/board-assistance.v1";
import type { FabricAiSseEventName, FabricAiSsePayloads } from "@/lib/ai/sse";
import { requireBoardCapability } from "@/lib/boards/authorization";
import {
  readAuthoritativeCanvasDocument,
  type CanvasDocumentSnapshot,
} from "@/lib/boards/canvas-document";
import { BoardApiError } from "@/lib/boards/http";
import {
  canvasSourceGeometryForTldrawShapeRecord,
  projectedCanvasNodeIdMapForTldrawShapeRecords,
} from "@/lib/boards/tldraw-document";

const SDK_VERSION = "native-fetch-sse.v1";
const POLICY_VERSION = "fabric-ai-policy.v1";
const CONFIG_VERSION = "fabric-ai-config.v3";

export type StoredRunEvent = {
  runId: string;
  sequence: number;
  type: FabricAiSseEventName;
  payload: FabricAiSsePayloads[FabricAiSseEventName];
  createdAt: Date;
};

function staleSnapshot(code: string, message: string): BoardApiError {
  return new BoardApiError(409, code, message);
}

function canonicalSelection(
  request: AiProposalRequest,
  snapshot: CanvasDocumentSnapshot,
): AiProposalRequest["selection"] {
  const currentNodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const durableShapes = new Map<string, Record<string, unknown>>();
  const shapeRecords = Object.values(snapshot.tldraw?.snapshot.store ?? {})
    .filter((record) => record.typeName === "shape") as Record<string, unknown>[];
  const projectedIds = projectedCanvasNodeIdMapForTldrawShapeRecords(shapeRecords);
  for (const record of shapeRecords) {
    if (record.typeName !== "shape" || record.type === "arrow" || record.type === "group") {
      continue;
    }
    const nodeId = projectedIds.get(String(record.id));
    if (!nodeId) continue;
    // The semantic projection keeps the first valid node id and assigns a
    // deterministic fallback to duplicate metadata. Mirror that behavior so
    // a duplicate shape cannot replace the selected shape's durable geometry.
    if (!durableShapes.has(nodeId)) {
      durableShapes.set(nodeId, record as Record<string, unknown>);
    }
  }
  return request.selection.map((requestedNode) => {
    const node = currentNodes.get(requestedNode.id);
    if (!node) {
      throw staleSnapshot(
        "stale_selection",
        "The selected canvas objects changed before the AI run was created.",
      );
    }
    const rawShape = durableShapes.get(node.id);
    const source = rawShape
      ? canvasSourceGeometryForTldrawShapeRecord(rawShape)
      : undefined;
    const result = ProposalNodeSnapshotSchema.safeParse({
      id: node.id,
      type: node.type,
      title: node.title,
      ...(node.body !== undefined ? { body: node.body } : {}),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      ...(node.locked !== undefined ? { locked: node.locked } : {}),
      ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
      ...(node.tag !== undefined ? { tag: node.tag } : {}),
      ...(source ? { source } : {}),
    });
    if (!result.success) {
      throw staleSnapshot(
        "invalid_board_snapshot",
        "The selected canvas objects could not be prepared safely.",
      );
    }
    return result.data;
  });
}

export async function authorizeProposalSnapshot(
  principalId: string,
  request: AiProposalRequest,
): Promise<AiProposalRequest> {
  const access = await requireBoardCapability(principalId, request.boardId, "edit_board");
  const [current] = await db
    .select({
      id: boards.id,
      workspaceId: boards.workspaceId,
      documentGenerationId: boards.documentGenerationId,
      revision: boards.revision,
      document: boards.document,
    })
    .from(boards)
    .where(and(eq(boards.id, request.boardId), isNull(boards.archivedAt)))
    .limit(1);

  if (!current || access.workspaceId !== current.workspaceId) {
    throw new BoardApiError(404, "not_found", "The requested board was not found.");
  }
  if (request.workspaceId !== current.workspaceId) {
    throw staleSnapshot("workspace_mismatch", "The board no longer belongs to this workspace.");
  }
  if (request.documentGenerationId !== current.documentGenerationId) {
    throw staleSnapshot("stale_generation", "The board document was replaced. Reload and try again.");
  }

  const durableSequence = current.revision;
  if (request.durableSequence !== durableSequence) {
    throw staleSnapshot("stale_sequence", "The board changed before the AI run was created.");
  }

  // Reproject the lossless tldraw checkpoint on every authorization so legacy
  // rows immediately receive current lock/transform safety. Stored semantic
  // nodes remain the fallback only for documents without a tldraw checkpoint.
  const snapshot = readAuthoritativeCanvasDocument(current.document);
  const selection = canonicalSelection(request, snapshot);
  return {
    ...request,
    workspaceId: current.workspaceId,
    boardId: current.id,
    documentGenerationId: current.documentGenerationId,
    durableSequence,
    selection,
    scene: buildAuthorizedBoardScene({
      snapshot,
      selection,
      viewport: request.viewport,
    }),
  };
}

export async function createOrReuseAiRun(input: {
  principalId: string;
  request: AiProposalRequest;
  idempotencyKey: string;
  now?: Date;
}): Promise<{ runId: string; created: boolean }> {
  const now = input.now ?? new Date();
  const provenance = loadAiRunProvenance();
  const skill = getBoardAssistanceSkill().manifest;
  const idempotencyHash = hashIdempotencyKey(input.principalId, input.idempotencyKey);
  const selectionHash = hashCanonicalJson(input.request.selection);
  const executionInput = input.request;
  const inputHash = hashCanonicalJson({
    principalId: input.principalId,
    executionInput,
    skillId: skill.id,
    skillVersion: skill.version,
    promptVersion: skill.promptVersion,
    policyVersion: POLICY_VERSION,
    provider: provenance.provider,
    model: provenance.model,
  });
  const deadlineAt = new Date(now.getTime() + skill.limits.maxWallTimeMs);

  return db.transaction(async (transaction) => {
    const findExisting = async () => {
      const [existing] = await transaction
        .select({ id: aiRuns.id, inputHash: aiRuns.inputHash })
        .from(aiRuns)
        .where(
          and(
            eq(aiRuns.principalId, input.principalId),
            eq(aiRuns.idempotencyHash, idempotencyHash),
          ),
        )
        .limit(1);
      return existing ?? null;
    };

    const beforeInsert = resolveIdempotentRun(await findExisting(), inputHash);
    if (beforeInsert.action === "reuse") return { runId: beforeInsert.runId, created: false };
    if (beforeInsert.action === "conflict") {
      throw new BoardApiError(
        409,
        "idempotency_conflict",
        "This idempotency key was already used for a different AI request.",
      );
    }

    const runId = randomUUID();
    const [created] = await transaction
      .insert(aiRuns)
      .values({
        id: runId,
        principalId: input.principalId,
        workspaceId: input.request.workspaceId,
        boardId: input.request.boardId,
        documentGenerationId: input.request.documentGenerationId,
        baseDurableSequence: input.request.durableSequence,
        selectionHash,
        idempotencyHash,
        inputHash,
        executionInput,
        skillId: skill.id,
        skillVersion: skill.version,
        promptVersion: skill.promptVersion,
        policyVersion: POLICY_VERSION,
        provider: provenance.provider,
        model: provenance.model,
        sdkVersion: SDK_VERSION,
        configVersion: CONFIG_VERSION,
        lastEventSequence: 2,
        deadlineAt,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: aiRuns.id });

    if (!created) {
      const raced = resolveIdempotentRun(await findExisting(), inputHash);
      if (raced.action === "reuse") return { runId: raced.runId, created: false };
      throw new BoardApiError(
        409,
        "idempotency_conflict",
        "This idempotency key was already used for a different AI request.",
      );
    }

    await transaction.insert(aiJobs).values({
      runId,
      maxAttempts: skill.limits.maxRetries + 1,
      availableAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(aiRunEvents).values([
      {
        runId,
        sequence: 1,
        type: "run.started",
        payload: {
          skill: skill.id,
          skillVersion: skill.version,
          promptVersion: skill.promptVersion,
          provider: provenance.provider,
          model: provenance.model,
        },
        createdAt: now,
      },
      {
        runId,
        sequence: 2,
        type: "run.progress",
        payload: { phase: "queued", message: "AI proposal queued for secure processing…" },
        createdAt: now,
      },
    ]);
    return { runId, created: true };
  });
}

export async function getOwnedAiRun(principalId: string, runId: string) {
  const [run] = await db
    .select({
      id: aiRuns.id,
      boardId: aiRuns.boardId,
      status: aiRuns.status,
      lastEventSequence: aiRuns.lastEventSequence,
      cancelRequestedAt: aiRuns.cancelRequestedAt,
      deadlineAt: aiRuns.deadlineAt,
    })
    .from(aiRuns)
    .where(and(eq(aiRuns.id, runId), eq(aiRuns.principalId, principalId)))
    .limit(1);
  if (!run) throw new BoardApiError(404, "not_found", "The requested AI run was not found.");
  await requireBoardCapability(principalId, run.boardId, "view");
  return run;
}

export async function listOwnedAiRunEvents(
  principalId: string,
  runId: string,
  afterSequence: number,
): Promise<{ status: AiRunStatus; events: StoredRunEvent[] }> {
  const rows = await db
    .select({
      boardId: aiRuns.boardId,
      status: aiRuns.status,
      eventRunId: aiRunEvents.runId,
      sequence: aiRunEvents.sequence,
      type: aiRunEvents.type,
      payload: aiRunEvents.payload,
      createdAt: aiRunEvents.createdAt,
    })
    .from(aiRuns)
    .leftJoin(
      aiRunEvents,
      and(
        eq(aiRunEvents.runId, aiRuns.id),
        gt(aiRunEvents.sequence, afterSequence),
      ),
    )
    .where(and(eq(aiRuns.id, runId), eq(aiRuns.principalId, principalId)))
    .orderBy(asc(aiRunEvents.sequence))
    .limit(200);
  const run = rows[0];
  if (!run) throw new BoardApiError(404, "not_found", "The requested AI run was not found.");
  await requireBoardCapability(principalId, run.boardId, "view");
  return {
    status: run.status,
    events: rows.flatMap((event) =>
      event.eventRunId &&
      event.sequence !== null &&
      event.type !== null &&
      event.payload !== null &&
      event.createdAt !== null
        ? [{
            runId: event.eventRunId,
            sequence: event.sequence,
            type: event.type as FabricAiSseEventName,
            payload: event.payload as FabricAiSsePayloads[FabricAiSseEventName],
            createdAt: event.createdAt,
          }]
        : [],
    ),
  };
}

export async function requestAiRunCancellation(
  principalId: string,
  runId: string,
  now = new Date(),
): Promise<{ status: AiRunStatus; canceled: boolean }> {
  const [ownedRun] = await db
    .select({ boardId: aiRuns.boardId })
    .from(aiRuns)
    .where(and(eq(aiRuns.id, runId), eq(aiRuns.principalId, principalId)))
    .limit(1);
  if (!ownedRun) {
    throw new BoardApiError(404, "not_found", "The requested AI run was not found.");
  }
  await requireBoardCapability(principalId, ownedRun.boardId, "edit_board");

  return db.transaction(async (transaction) => {
    const [run] = await transaction
      .select({
        id: aiRuns.id,
        status: aiRuns.status,
        lastEventSequence: aiRuns.lastEventSequence,
      })
      .from(aiRuns)
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.principalId, principalId)))
      .for("update")
      .limit(1);
    if (!run) throw new BoardApiError(404, "not_found", "The requested AI run was not found.");
    if (isTerminalAiRunStatus(run.status)) return { status: run.status, canceled: false };

    const nextSequence = run.lastEventSequence + 1;
    await transaction
      .update(aiRuns)
      .set({
        status: "canceled",
        executionInput: { redacted: true },
        cancelRequestedAt: now,
        finishedAt: now,
        lastEventSequence: nextSequence,
        updatedAt: now,
      })
      .where(eq(aiRuns.id, run.id));
    await transaction
      .update(aiJobs)
      .set({ status: "canceled", leaseOwner: null, leaseExpiresAt: null, updatedAt: now })
      .where(eq(aiJobs.runId, run.id));
    await transaction.insert(aiRunEvents).values({
      runId: run.id,
      sequence: nextSequence,
      type: "run.canceled",
      payload: { reason: "canceled" },
      createdAt: now,
    });
    return { status: "canceled", canceled: true };
  });
}

export async function recordAiRunDispatchFailure(
  principalId: string,
  runId: string,
  now = new Date(),
): Promise<boolean> {
  return db.transaction(async (transaction) => {
    const [run] = await transaction
      .select({ status: aiRuns.status, lastEventSequence: aiRuns.lastEventSequence })
      .from(aiRuns)
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.principalId, principalId)))
      .for("update")
      .limit(1);
    if (
      !run ||
      ![
        "queued",
        "preparing_context",
        "calling_model",
        "building_proposal",
        "validating_proposal",
      ].includes(run.status)
    ) {
      return false;
    }

    const nextSequence = run.lastEventSequence + 1;
    const safeError = {
      code: "provider_unavailable",
      message: "AI processing is temporarily unavailable. Try again shortly.",
      retryable: true,
    } as const;
    await transaction
      .update(aiRuns)
      .set({
        status: "provider_unavailable",
        safeError,
        executionInput: { redacted: true },
        finishedAt: now,
        lastEventSequence: nextSequence,
        updatedAt: now,
      })
      .where(eq(aiRuns.id, runId));
    await transaction
      .update(aiJobs)
      .set({
        status: "dead",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: safeError.code,
        updatedAt: now,
      })
      .where(eq(aiJobs.runId, runId));
    await transaction.insert(aiRunEvents).values({
      runId,
      sequence: nextSequence,
      type: "run.error",
      payload: safeError,
      createdAt: now,
    });
    return true;
  });
}
