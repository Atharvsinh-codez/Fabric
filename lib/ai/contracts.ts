import type { CanvasPatch } from "./canvas-patch";
import type { PatchRiskClass } from "./semantic-validator";

import type { FabricAiModel, FabricAiProvider } from "./config";

export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export type JsonSchema = Readonly<Record<string, unknown>>;

export type ModelImageInput = Readonly<{
  /** A short-lived HTTPS URL issued by Fabric for this one authorized run. */
  url: string;
  label: string;
  detail?: "auto" | "high" | "low";
}>;

export type ModelUsage = Readonly<{
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  thoughtTokens?: number;
  toolTokens?: number;
  totalTokens?: number;
}>;

export type ModelStreamEvent =
  | Readonly<{ type: "interaction_started"; interactionId: string }>
  | Readonly<{ type: "status"; status: string }>
  | Readonly<{ type: "text_delta"; text: string }>
  | Readonly<{ type: "interaction_completed"; usage: ModelUsage }>;

export type ModelTurnRequest = Readonly<{
  input: string;
  images?: readonly ModelImageInput[];
  systemInstruction: string;
  thinkingLevel: ThinkingLevel;
  maxOutputTokens: number;
  responseSchema: JsonSchema;
  timeoutMs: number;
  /** Durable zero-based slot allocated when the AI job is claimed. */
  keyRotationOrdinal?: number;
  signal?: AbortSignal;
}>;

export type ModelTurn = Readonly<{
  events: AsyncIterable<ModelStreamEvent>;
}>;

export interface FabricModelProvider {
  readonly provider: FabricAiProvider;
  readonly model: FabricAiModel;
  createTurn(request: ModelTurnRequest): Promise<ModelTurn>;
}

export type FabricModelErrorCode =
  | "aborted"
  | "invalid_request"
  | "rate_limited"
  | "provider_authentication_failed"
  | "provider_unavailable"
  | "provider_stream_failed";

export class FabricModelError extends Error {
  readonly code: FabricModelErrorCode;
  readonly retryable: boolean;

  constructor(code: FabricModelErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "FabricModelError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type SkillManifest = Readonly<{
  id: string;
  version: string;
  promptVersion: string;
  description: string;
  requiredCapabilities: readonly string[];
  allowedTools: readonly string[];
  allowedOperations: readonly CanvasPatch["operations"][number]["type"][];
  thinkingLevel: ThinkingLevel;
  result: "read-only" | "canvas-patch-proposal";
  limits: Readonly<{
    maxModelTurns: number;
    maxToolCalls: number;
    maxOutputTokens: number;
    maxWallTimeMs: number;
    maxRetries: number;
    maxPatchBytes: number;
    maxOperations: number;
    maxAffectedNodes: number;
  }>;
}>;

export type ProposalReadyPayload = Readonly<{
  patch: CanvasPatch;
  patchHash: string;
  patchBytes: number;
  affectedNodeIds: readonly string[];
  riskClass: PatchRiskClass;
}>;
