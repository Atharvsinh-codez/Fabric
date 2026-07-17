import { createHash } from "node:crypto";

import {
  FabricModelError,
  type FabricModelProvider,
  type ModelUsage,
} from "../lib/ai/contracts";
import { BoardPlanSchema, BOARD_PLAN_JSON_SCHEMA } from "../lib/ai/engine/board-plan";
import { buildSelectionOnlyAuthorizedScene } from "../lib/ai/engine/authorized-scene";
import {
  BoardPlanCompileError,
  CANVAS_COMPILER_VERSION,
  compileBoardProposal,
} from "../lib/ai/engine/compiler";
import { hashCanonicalJson } from "../lib/ai/hash";
import { AiProposalRequestSchema } from "../lib/ai/proposal-request";
import { retryDelayMs } from "../lib/ai/run-state";
import { validateCanvasPatchSemantics } from "../lib/ai/semantic-validator";
import {
  buildBoardAssistanceTurnInput,
  getBoardAssistanceSkill,
} from "../lib/ai/skills/board-assistance.v1";

import type { WorkerSql } from "./database";
import {
  buildAiModelImages,
  type AiMediaConfiguration,
} from "./media-context";
import {
  baseSnapshotIsCurrent,
  type ClaimedAiJob,
  readAiRunControl,
  recordClarificationReady,
  recordProposalReady,
  recordProviderInteractionId,
  recordRunCanceled,
  recordRunFailure,
  recordRunProgress,
  refreshAiJobLease,
  releaseAiJobForRetry,
} from "./repository";

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
  media?: AiMediaConfiguration;
  buildModelImages?: typeof buildAiModelImages;
}): Promise<void> {
  const { sql, job, provider } = input;
  const processingStartedAt = Date.now();
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
  if (job.skillVersion !== manifest.version || job.promptVersion !== manifest.promptVersion) {
    await recordRunFailure(sql, {
      job,
      status: "provider_unavailable",
      error: {
        code: "provider_error",
        message: "Fabric agent was upgraded while this request was queued. Please try again.",
        retryable: true,
      },
    });
    return;
  }
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

    const modelImages = input.media
      ? await (input.buildModelImages ?? buildAiModelImages)({
          sql,
          job,
          request,
          media: input.media,
        })
      : [];
    const contextPreparedAt = Date.now();

    await recordRunProgress(sql, {
      runId: job.runId,
      status: "calling_model",
      phase: "calling_model",
      message: skill.progressMessage,
    });
    const modelStartedAt = Date.now();
    const modelInput = buildBoardAssistanceTurnInput(request);
    const turn = await provider.createTurn({
      input: modelInput.input,
      ...(modelImages.length > 0 ? { images: modelImages } : {}),
      systemInstruction: skill.systemInstruction,
      thinkingLevel: manifest.thinkingLevel,
      maxOutputTokens: manifest.limits.maxOutputTokens,
      responseSchema: BOARD_PLAN_JSON_SCHEMA,
      timeoutMs: Math.max(1_000, job.deadlineAt.getTime() - Date.now()),
      keyRotationOrdinal: job.providerKeyOrdinal - 1,
      signal: controller.signal,
    });

    let output = "";
    let outputBytes = 0;
    let firstContentAt: number | null = null;
    for await (const event of turn.events) {
      controller.signal.throwIfAborted();
      if (event.type === "interaction_started") {
        await recordProviderInteractionId(sql, job.runId, event.interactionId);
      } else if (event.type === "text_delta") {
        firstContentAt ??= Date.now();
        output += event.text;
        const deltaBytes = new TextEncoder().encode(event.text).byteLength;
        outputBytes += deltaBytes;
        if (outputBytes > maxAccumulatedOutputBytes) {
          throw new FabricModelError("invalid_request", "The response exceeded its byte budget");
        }
      } else if (event.type === "interaction_completed") {
        usage = event.usage;
      }
    }
    const modelCompletedAt = Date.now();

    if (await cancelIfRequested(sql, job.runId)) return;
    const responseHash = createHash("sha256").update(output, "utf8").digest("hex");
    const scene = request.scene ?? buildSelectionOnlyAuthorizedScene({
      selection: request.selection,
      viewport: request.viewport,
    });
    const measuredUsage = (input: {
      planActionCount: number;
      compiledOperationCount: number;
      compileMs: number;
    }): ModelUsage => ({
      ...usage,
      fabric: {
        engineVersion: "board-plan.v1",
        compilerVersion: CANVAS_COMPILER_VERSION,
        sceneVersion: scene.version,
        sceneNodeCount: scene.nodes.length,
        sceneEdgeCount: scene.edges.length,
        selectedNodeCount: scene.nodes.filter((node) => node.role === "selected").length,
        visualInputCount: modelImages.length,
        modelInputBytes: modelInput.metrics.inputBytes,
        sceneNodesOmitted: modelInput.metrics.sceneNodesOmitted,
        sceneEdgesOmitted: modelInput.metrics.sceneEdgesOmitted,
        sceneTextCharactersOmitted: modelInput.metrics.sceneTextCharactersOmitted,
        conversationMessagesOmitted: modelInput.metrics.conversationMessagesOmitted,
        planActionCount: input.planActionCount,
        compiledOperationCount: input.compiledOperationCount,
        contextPreparationMs: Math.max(0, contextPreparedAt - processingStartedAt),
        modelLatencyMs: Math.max(0, modelCompletedAt - modelStartedAt),
        ...(firstContentAt === null
          ? {}
          : { timeToFirstContentMs: Math.max(0, firstContentAt - modelStartedAt) }),
        compileMs: input.compileMs,
        outputBytes,
      },
    });
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
        responseHash,
        usage: measuredUsage({
          planActionCount: 0,
          compiledOperationCount: 0,
          compileMs: 0,
        }),
        error: {
          code: "invalid_model_output",
          message: "AI returned a proposal that could not be reviewed safely.",
          retryable: false,
        },
      });
      return;
    }
    const planResult = BoardPlanSchema.safeParse(parsedOutput);
    if (!planResult.success) {
      await recordRunFailure(sql, {
        job,
        status: "validation_failed",
        responseHash,
        usage: measuredUsage({
          planActionCount: 0,
          compiledOperationCount: 0,
          compileMs: 0,
        }),
        error: {
          code: "invalid_model_output",
          message: "AI returned a plan that did not match the Fabric agent contract.",
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
        responseHash,
        usage: measuredUsage({
          planActionCount: planResult.data.kind === "proposal" ? planResult.data.actions.length : 0,
          compiledOperationCount: 0,
          compileMs: 0,
        }),
        error: {
          code: "stale_generation",
          message: "The board changed while the proposal was being generated.",
          retryable: false,
        },
      });
      return;
    }
    if (planResult.data.kind === "clarification") {
      await recordClarificationReady(sql, {
        job,
        clarification: {
          kind: "clarification",
          reason: planResult.data.reason,
          question: planResult.data.question,
          choices: planResult.data.choices,
        },
        responseHash,
        usage: measuredUsage({
          planActionCount: 0,
          compiledOperationCount: 0,
          compileMs: 0,
        }),
      });
      return;
    }

    let patch;
    let compileMs = 0;
    const compileStartedAt = Date.now();
    try {
      patch = compileBoardProposal({
        proposal: planResult.data,
        scene,
        base: patchBase,
      });
      compileMs = Math.max(0, Date.now() - compileStartedAt);
    } catch (error) {
      compileMs = Math.max(0, Date.now() - compileStartedAt);
      const issueCode = error instanceof BoardPlanCompileError ? error.code : "compile_failed";
      await recordRunFailure(sql, {
        job,
        status: "validation_failed",
        responseHash,
        usage: measuredUsage({
          planActionCount: planResult.data.actions.length,
          compiledOperationCount: 0,
          compileMs,
        }),
        error: {
          code: "semantic_validation_failed",
          message: "Fabric agent could not compile a readable change for this board snapshot.",
          retryable: false,
          issueCodes: [issueCode],
        },
      });
      return;
    }

    const semanticResult = validateCanvasPatchSemantics(patch, {
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
        responseHash,
        usage: measuredUsage({
          planActionCount: planResult.data.actions.length,
          compiledOperationCount: patch.operations.length,
          compileMs,
        }),
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
      patch,
      patchHash: hashCanonicalJson(patch),
      patchBytes: semanticResult.patchBytes,
      affectedNodeIds: semanticResult.affectedNodeIds,
      riskClass: semanticResult.riskClass,
    } as const;
    await recordProposalReady(sql, {
      job,
      proposal,
      responseHash,
      usage: measuredUsage({
        planActionCount: planResult.data.actions.length,
        compiledOperationCount: patch.operations.length,
        compileMs,
      }),
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
