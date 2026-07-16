import { createHash } from "node:crypto";

import { CanvasPatchSchema, CANVAS_PATCH_JSON_SCHEMA } from "../lib/ai/canvas-patch";
import {
  FabricModelError,
  type FabricModelProvider,
  type ModelUsage,
} from "../lib/ai/contracts";
import { hashCanonicalJson } from "../lib/ai/hash";
import { AiProposalRequestSchema } from "../lib/ai/proposal-request";
import { retryDelayMs } from "../lib/ai/run-state";
import { validateCanvasPatchSemantics } from "../lib/ai/semantic-validator";
import {
  buildBoardAssistanceInput,
  getBoardAssistanceSkill,
} from "../lib/ai/skills/board-assistance.v1";

import type { WorkerSql } from "./database";
import {
  baseSnapshotIsCurrent,
  type ClaimedAiJob,
  readAiRunControl,
  recordProposalDelta,
  recordProposalReady,
  recordProviderInteractionId,
  recordRunCanceled,
  recordRunFailure,
  recordRunProgress,
  refreshAiJobLease,
  releaseAiJobForRetry,
} from "./repository";

const PROPOSAL_DELTA_FLUSH_BYTES = 8 * 1_024;
const PROPOSAL_DELTA_FLUSH_MS = 750;

type AbortReason = "canceled" | "deadline_exceeded" | "lease_lost";

function abortReason(signal: AbortSignal): AbortReason | null {
  const reason = signal.reason;
  return reason === "canceled" || reason === "deadline_exceeded" || reason === "lease_lost"
    ? reason
    : null;
}

function safeProviderFailure(error: unknown): {
  status: "provider_unavailable" | "validation_failed" | "budget_exceeded";
  error: {
    code:
      | "rate_limited"
      | "provider_unavailable"
      | "provider_misconfigured"
      | "provider_error"
      | "budget_exceeded";
    message: string;
    retryable: boolean;
  };
} {
  if (!(error instanceof FabricModelError)) {
    return {
      status: "provider_unavailable",
      error: {
        code: "provider_error",
        message: "The AI proposal could not be generated.",
        retryable: false,
      },
    };
  }
  if (error.code === "rate_limited") {
    return {
      status: "provider_unavailable",
      error: { code: "rate_limited", message: "AI is busy. Try again shortly.", retryable: true },
    };
  }
  if (error.code === "provider_authentication_failed") {
    return {
      status: "provider_unavailable",
      error: {
        code: "provider_misconfigured",
        message: "AI is not configured for this deployment.",
        retryable: false,
      },
    };
  }
  if (error.code === "invalid_request") {
    return {
      status: "validation_failed",
      error: {
        code: "provider_error",
        message: "The AI provider rejected this bounded proposal request.",
        retryable: false,
      },
    };
  }
  return {
    status: "provider_unavailable",
    error: {
      code: "provider_unavailable",
      message: "AI is temporarily unavailable.",
      retryable: error.retryable,
    },
  };
}

async function cancelIfRequested(sql: WorkerSql, runId: string): Promise<boolean> {
  const control = await readAiRunControl(sql, runId);
  if (!control) return true;
  if (control.cancelRequestedAt || control.status === "canceled") {
    await recordRunCanceled(sql, { runId, reason: "canceled" });
    return true;
  }
  if (control.deadlineAt <= new Date()) {
    await recordRunCanceled(sql, { runId, reason: "deadline_exceeded" });
    return true;
  }
  return false;
}

export async function processClaimedAiJob(input: {
  sql: WorkerSql;
  job: ClaimedAiJob;
  provider: FabricModelProvider;
  leaseMs: number;
}): Promise<void> {
  const { sql, job, provider } = input;
  const requestResult = AiProposalRequestSchema.safeParse(job.executionInput);
  if (!requestResult.success) {
    await recordRunFailure(sql, {
      job,
      status: "validation_failed",
      error: {
        code: "provider_error",
        message: "The durable AI request could not be verified.",
        retryable: false,
      },
    });
    return;
  }

  if (await cancelIfRequested(sql, job.runId)) return;
  if (job.provider !== provider.provider || job.model !== provider.model) {
    await recordRunFailure(sql, {
      job,
      status: "provider_unavailable",
      error: {
        code: "provider_misconfigured",
        message: "AI is not configured for this deployment.",
        retryable: false,
      },
    });
    return;
  }
  if (!(await baseSnapshotIsCurrent(sql, job))) {
    await recordRunFailure(sql, {
      job,
      status: "stale_generation",
      error: {
        code: "stale_generation",
        message: "The board changed before the proposal could be generated.",
        retryable: false,
      },
    });
    return;
  }

  const request = requestResult.data;
  const skill = getBoardAssistanceSkill();
  const manifest = skill.manifest;
  const maxAccumulatedOutputBytes = manifest.limits.maxPatchBytes * 2;
  const patchBase = {
    workspaceId: job.workspaceId,
    boardId: job.boardId,
    documentGenerationId: job.documentGenerationId,
    durableSequence: job.baseDurableSequence,
    selectionHash: job.selectionHash,
  } as const;
  const controller = new AbortController();
  let checkingLease = false;
  const heartbeat = setInterval(async () => {
    if (checkingLease || controller.signal.aborted) return;
    checkingLease = true;
    try {
      const control = await readAiRunControl(sql, job.runId);
      if (!control || control.cancelRequestedAt || control.status === "canceled") {
        controller.abort("canceled");
        return;
      }
      if (control.deadlineAt <= new Date()) {
        controller.abort("deadline_exceeded");
        return;
      }
      const refreshed = await refreshAiJobLease(sql, {
        jobId: job.jobId,
        workerId: job.leaseOwner,
        leaseMs: input.leaseMs,
      });
      if (!refreshed) controller.abort("lease_lost");
    } catch {
      controller.abort("lease_lost");
    } finally {
      checkingLease = false;
    }
  }, Math.max(5_000, Math.floor(input.leaseMs / 3)));

  let usage: ModelUsage = {};
  try {
    if (
      !(await recordRunProgress(sql, {
        runId: job.runId,
        status: "preparing_context",
        phase: "preparing_context",
        message: "Preparing the authorized board selection…",
      }))
    ) {
      if (await cancelIfRequested(sql, job.runId)) return;
      throw new FabricModelError("provider_stream_failed", "The run state could not advance", true);
    }

    await recordRunProgress(sql, {
      runId: job.runId,
      status: "calling_model",
      phase: "calling_model",
      message: skill.progressMessage,
    });
    const turn = await provider.createTurn({
      input: buildBoardAssistanceInput(request, patchBase),
      systemInstruction: skill.systemInstruction,
      thinkingLevel: manifest.thinkingLevel,
      maxOutputTokens: manifest.limits.maxOutputTokens,
      responseSchema: CANVAS_PATCH_JSON_SCHEMA,
      timeoutMs: Math.max(1_000, job.deadlineAt.getTime() - Date.now()),
      keyRotationOrdinal: job.providerKeyOrdinal - 1,
      signal: controller.signal,
    });

    let output = "";
    let outputBytes = 0;
    let pendingDelta = "";
    let pendingDeltaBytes = 0;
    let hasPersistedDelta = false;
    let lastDeltaPersistedAt = 0;
    const flushProposalDelta = async (force = false): Promise<void> => {
      if (!pendingDelta) return;
      const now = Date.now();
      if (
        !force &&
        hasPersistedDelta &&
        pendingDeltaBytes < PROPOSAL_DELTA_FLUSH_BYTES &&
        now - lastDeltaPersistedAt < PROPOSAL_DELTA_FLUSH_MS
      ) {
        return;
      }

      const text = pendingDelta;
      pendingDelta = "";
      pendingDeltaBytes = 0;
      if (!(await recordProposalDelta(sql, job.runId, text))) {
        controller.abort("canceled");
        controller.signal.throwIfAborted();
      }
      hasPersistedDelta = true;
      lastDeltaPersistedAt = now;
    };

    for await (const event of turn.events) {
      controller.signal.throwIfAborted();
      if (event.type === "interaction_started") {
        await recordProviderInteractionId(sql, job.runId, event.interactionId);
      } else if (event.type === "text_delta") {
        output += event.text;
        const deltaBytes = new TextEncoder().encode(event.text).byteLength;
        outputBytes += deltaBytes;
        pendingDelta += event.text;
        pendingDeltaBytes += deltaBytes;
        if (outputBytes > maxAccumulatedOutputBytes) {
          throw new FabricModelError("invalid_request", "The response exceeded its byte budget");
        }
        await flushProposalDelta();
      } else if (event.type === "interaction_completed") {
        usage = event.usage;
      }
    }
    await flushProposalDelta(true);

    if (await cancelIfRequested(sql, job.runId)) return;
    await recordRunProgress(sql, {
      runId: job.runId,
      status: "building_proposal",
      phase: "building_proposal",
      message: "Building the reviewable canvas proposal…",
    });

    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(output);
    } catch {
      await recordRunFailure(sql, {
        job,
        status: "validation_failed",
        error: {
          code: "invalid_model_output",
          message: "AI returned a proposal that could not be reviewed safely.",
          retryable: false,
        },
      });
      return;
    }
    const patchResult = CanvasPatchSchema.safeParse(parsedOutput);
    if (!patchResult.success) {
      await recordRunFailure(sql, {
        job,
        status: "validation_failed",
        error: {
          code: "invalid_model_output",
          message: "AI returned a proposal that did not match the canvas contract.",
          retryable: false,
        },
      });
      return;
    }

    await recordRunProgress(sql, {
      runId: job.runId,
      status: "validating_proposal",
      phase: "validating_proposal",
      message: "Checking board scope, geometry, and operation limits…",
    });
    if (!(await baseSnapshotIsCurrent(sql, job))) {
      await recordRunFailure(sql, {
        job,
        status: "stale_generation",
        error: {
          code: "stale_generation",
          message: "The board changed while the proposal was being generated.",
          retryable: false,
        },
      });
      return;
    }
    const semanticResult = validateCanvasPatchSemantics(patchResult.data, {
      base: patchBase,
      nodes: request.selection.map((node) => ({
        id: node.id,
        type: node.type,
        width: node.width,
        height: node.height,
        locked: node.locked,
        parentId: node.parentId,
      })),
      allowedOperations: manifest.allowedOperations,
      allowedCreatedNodeTypes: skill.allowedCreatedNodeTypes,
      limits: {
        maxPatchBytes: manifest.limits.maxPatchBytes,
        maxOperations: manifest.limits.maxOperations,
        maxAffectedNodes: manifest.limits.maxAffectedNodes,
      },
    });
    if (!semanticResult.ok) {
      await recordRunFailure(sql, {
        job,
        status: "validation_failed",
        error: {
          code: "semantic_validation_failed",
          message: "AI returned a proposal that is not safe for this board snapshot.",
          retryable: false,
          issueCodes: [...new Set(semanticResult.issues.map((issue) => issue.code))],
        },
      });
      return;
    }

    const proposal = {
      patch: patchResult.data,
      patchHash: hashCanonicalJson(patchResult.data),
      patchBytes: semanticResult.patchBytes,
      affectedNodeIds: semanticResult.affectedNodeIds,
      riskClass: semanticResult.riskClass,
    } as const;
    await recordProposalReady(sql, {
      job,
      proposal,
      responseHash: createHash("sha256").update(output, "utf8").digest("hex"),
      usage,
    });
  } catch (error) {
    const reason = abortReason(controller.signal);
    if (reason === "lease_lost") return;
    if (reason === "canceled" || reason === "deadline_exceeded") {
      await recordRunCanceled(sql, {
        runId: job.runId,
        reason: reason === "deadline_exceeded" ? "deadline_exceeded" : "canceled",
      });
      return;
    }

    const failure = safeProviderFailure(error);
    if (
      failure.error.retryable &&
      job.attempt < job.maxAttempts &&
      job.deadlineAt.getTime() - Date.now() > 2_000
    ) {
      const availableAt = new Date(Date.now() + retryDelayMs(job.attempt, Math.random() * 0.4 - 0.2));
      const released = await releaseAiJobForRetry(sql, {
        job,
        availableAt,
        errorCode: failure.error.code,
        message: "The model call was interrupted; retrying within the run budget…",
      });
      if (released) return;
    }
    await recordRunFailure(sql, { job, status: failure.status, error: failure.error });
  } finally {
    clearInterval(heartbeat);
  }
}
