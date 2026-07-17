import { z } from "zod";

import {
  AiProposalApprovalResultSchema,
  type AiProposalApprovalRequest,
  type AiProposalApprovalResult,
} from "./approval";
import { CanvasPatchSchema } from "./canvas-patch";
import type {
  AiAgentReadyResult,
  ClarificationReadyPayload,
  ProposalReadyPayload,
} from "./contracts";
import type { AiProposalRequest } from "./proposal-request";
import type {
  FabricAiSseEnvelope,
  FabricAiSseEventName,
} from "./sse";

const EnvelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    runId: z.string().min(1),
    sequence: z.number().int().positive(),
    emittedAt: z.string().min(1),
    type: z.enum([
      "run.started",
      "run.progress",
      "proposal.delta",
      "proposal.ready",
      "clarification.ready",
      "run.completed",
      "run.canceled",
      "run.error",
    ]),
    payload: z.unknown(),
  })
  .strict();

const ProposalReadyPayloadSchema = z
  .object({
    patch: CanvasPatchSchema,
    patchHash: z.string().regex(/^[a-f0-9]{64}$/),
    patchBytes: z.number().int().positive(),
    affectedNodeIds: z.array(z.string().min(1)),
    riskClass: z.enum(["low", "medium", "high"]),
  })
  .strict();

const ClarificationReadyPayloadSchema = z
  .object({
    kind: z.literal("clarification"),
    reason: z.enum(["ambiguous", "missing-context", "missing-selection", "unsupported"]),
    question: z.string().trim().min(1).max(400),
    choices: z.array(z.string().trim().min(1).max(120)).max(4),
  })
  .strict();

const ProgressPayloadSchema = z
  .object({
    phase: z.enum([
      "queued",
      "preparing_context",
      "calling_model",
      "building_proposal",
      "validating_proposal",
    ]),
    message: z.string().min(1),
  })
  .strict();

const ErrorPayloadSchema = z
  .object({
    code: z.enum([
      "invalid_model_output",
      "semantic_validation_failed",
      "rate_limited",
      "provider_unavailable",
      "provider_misconfigured",
      "provider_error",
      "budget_exceeded",
      "stale_generation",
      "expired_approval",
    ]),
    message: z.string().min(1),
    retryable: z.boolean(),
    issueCodes: z.array(z.string()).optional(),
  })
  .strict();

const CanceledPayloadSchema = z
  .object({
    reason: z.enum(["client_disconnected", "deadline_exceeded", "canceled"]),
  })
  .strict();

const HttpErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1).max(120).optional(),
        message: z.string().min(1).max(2_000).optional(),
        details: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AiClientEvent = FabricAiSseEnvelope;

export class AiProposalClientError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      details?: Readonly<Record<string, unknown>>;
    } = {},
  ) {
    super(message);
    this.name = "AiProposalClientError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.details = options.details;
  }
}

function validatePayload(
  type: FabricAiSseEventName,
  payload: unknown,
): unknown {
  if (type === "proposal.ready") return ProposalReadyPayloadSchema.parse(payload);
  if (type === "clarification.ready") return ClarificationReadyPayloadSchema.parse(payload);
  if (type === "run.progress") return ProgressPayloadSchema.parse(payload);
  if (type === "run.error") return ErrorPayloadSchema.parse(payload);
  if (type === "run.canceled") return CanceledPayloadSchema.parse(payload);
  return payload;
}

function parseSseRecord(record: string): AiClientEvent | null {
  const lines = record.split("\n");
  if (lines.every((line) => line === "" || line.startsWith(":"))) return null;

  const eventName = lines
    .find((line) => line.startsWith("event:"))
    ?.slice("event:".length)
    .trim();
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (!data) return null;
  const envelope = EnvelopeSchema.parse(JSON.parse(data));
  if (eventName && eventName !== envelope.type) {
    throw new AiProposalClientError(
      "invalid_stream",
      "The AI stream returned mismatched event metadata.",
    );
  }

  return {
    ...envelope,
    payload: validatePayload(envelope.type, envelope.payload),
  } as AiClientEvent;
}

async function readHttpError(response: Response): Promise<AiProposalClientError> {
  let code = "request_failed";
  let message = "The AI proposal could not be started. Try again.";
  let details: Readonly<Record<string, unknown>> | undefined;
  try {
    const parsed = HttpErrorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      if (parsed.data.error?.code) code = parsed.data.error.code;
      if (parsed.data.error?.message) message = parsed.data.error.message;
      details = parsed.data.error?.details;
    }
  } catch {
    // Preserve the safe fallback when a proxy returns a non-JSON response.
  }
  return new AiProposalClientError(code, message, {
    retryable: response.status === 429 || response.status >= 500,
    status: response.status,
    details,
  });
}

export async function streamAiProposal({
  request,
  signal,
  onEvent,
  onRunId,
}: {
  request: AiProposalRequest;
  signal: AbortSignal;
  onEvent?: (event: AiClientEvent) => void;
  onRunId?: (runId: string) => void;
}): Promise<AiAgentReadyResult> {
  let response = await fetch("/api/ai/proposal", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify(request),
    signal,
  });

  let runId = response.headers.get("x-fabric-ai-run-id")?.trim() || null;
  if (runId) onRunId?.(runId);
  let lastSequence = 0;
  let readyResult: AiAgentReadyResult | null = null;
  let cancelRequestStarted = false;
  const cancelRunAfterAbort = () => {
    if (!runId || cancelRequestStarted) return;
    cancelRequestStarted = true;
    void cancelAiProposal(runId).catch(() => undefined);
  };
  signal.addEventListener("abort", cancelRunAfterAbort);
  if (signal.aborted) cancelRunAfterAbort();

  const consume = (record: string) => {
    let event: AiClientEvent | null;
    try {
      event = parseSseRecord(record);
    } catch (error) {
      if (error instanceof AiProposalClientError) throw error;
      throw new AiProposalClientError(
        "invalid_stream",
        "The AI stream returned data Fabric could not verify.",
      );
    }
    if (!event) return;
    if (runId && event.runId !== runId) {
      throw new AiProposalClientError(
        "invalid_stream",
        "The AI stream changed run identity while reconnecting.",
      );
    }
    if (!runId) {
      runId = event.runId;
      onRunId?.(runId);
    }
    if (event.sequence <= lastSequence) {
      throw new AiProposalClientError(
        "invalid_stream",
        "The AI stream returned events out of order.",
      );
    }
    lastSequence = event.sequence;
    onEvent?.(event);

    if (event.type === "proposal.ready") {
      readyResult = event.payload as ProposalReadyPayload;
    } else if (event.type === "clarification.ready") {
      readyResult = event.payload as ClarificationReadyPayload;
    } else if (event.type === "run.error") {
      const payload = ErrorPayloadSchema.parse(event.payload);
      throw new AiProposalClientError(payload.code, payload.message, {
        retryable: payload.retryable,
      });
    } else if (event.type === "run.canceled") {
      throw new AiProposalClientError("canceled", "AI preview canceled.");
    }
  };

  const readStream = async (streamResponse: Response) => {
    if (!streamResponse.ok) throw await readHttpError(streamResponse);
    if (!streamResponse.headers.get("content-type")?.includes("text/event-stream")) {
      throw new AiProposalClientError(
        "invalid_stream",
        "The AI proposal stream was unavailable. Try again.",
        { retryable: true },
      );
    }
    if (!streamResponse.body) {
      throw new AiProposalClientError(
        "empty_stream",
        "The AI proposal stream ended before it began. Try again.",
        { retryable: true },
      );
    }

    const reader = streamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (done) break;
      }
      if (buffer.trim()) consume(buffer);
    } finally {
      reader.releaseLock();
    }
  };

  try {
    for (let attempt = 0; attempt <= 3 && !readyResult; attempt += 1) {
      try {
        await readStream(response);
      } catch (error) {
        if (signal.aborted || error instanceof AiProposalClientError) throw error;
        if (attempt >= 3) {
          throw new AiProposalClientError(
            "stream_disconnected",
            "The AI stream disconnected before the proposal was ready.",
            { retryable: true },
          );
        }
      }

      if (readyResult) break;
      if (!runId || attempt >= 3) break;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timeout);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        const timeout = setTimeout(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        }, 250 * 2 ** attempt);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      response = await fetch(
        `/api/ai/proposal?runId=${encodeURIComponent(runId)}&after=${lastSequence}`,
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            Accept: "text/event-stream",
            "Last-Event-ID": String(lastSequence),
          },
          signal,
        },
      );
    }

    if (!readyResult) {
      throw new AiProposalClientError(
        "incomplete_stream",
        "The AI stream ended before a reviewable proposal was ready. Try again.",
        { retryable: true },
      );
    }
    return readyResult;
  } finally {
    signal.removeEventListener("abort", cancelRunAfterAbort);
  }
}

export async function cancelAiProposal(runId: string): Promise<void> {
  const response = await fetch(`/api/ai/proposal?runId=${encodeURIComponent(runId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    keepalive: true,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await readHttpError(response);
}

export async function finalizeAiProposal(
  approval: AiProposalApprovalRequest,
): Promise<AiProposalApprovalResult> {
  const response = await fetch("/api/ai/proposal/approval", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(approval),
  });
  if (!response.ok) throw await readHttpError(response);
  try {
    return AiProposalApprovalResultSchema.parse(await response.json());
  } catch {
    throw new AiProposalClientError(
      "invalid_approval_response",
      "Fabric could not verify the AI approval receipt.",
    );
  }
}
