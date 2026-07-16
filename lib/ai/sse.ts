import type { ModelUsage, ProposalReadyPayload } from "./contracts";

import {
  FABRIC_AI_PROTOCOL_VERSION,
  type FabricAiModel,
  type FabricAiProvider,
} from "./config";

export type FabricAiSsePayloads = {
  "run.started": {
    skill: string;
    skillVersion: string;
    promptVersion: string;
    provider: FabricAiProvider;
    model: FabricAiModel;
  };
  "run.progress": {
    phase:
      | "queued"
      | "preparing_context"
      | "calling_model"
      | "building_proposal"
      | "validating_proposal";
    message: string;
  };
  "proposal.delta": {
    text: string;
  };
  "proposal.ready": ProposalReadyPayload;
  "run.completed": {
    usage: ModelUsage;
  };
  "run.canceled": {
    reason: "client_disconnected" | "deadline_exceeded" | "canceled";
  };
  "run.error": {
    code:
      | "invalid_model_output"
      | "semantic_validation_failed"
      | "rate_limited"
      | "provider_unavailable"
      | "provider_misconfigured"
      | "provider_error"
      | "budget_exceeded"
      | "stale_generation"
      | "expired_approval";
    message: string;
    retryable: boolean;
    issueCodes?: readonly string[];
  };
};

export type FabricAiSseEventName = keyof FabricAiSsePayloads;

export const FABRIC_AI_SSE_EVENT_NAMES = Object.freeze([
  "run.started",
  "run.progress",
  "proposal.delta",
  "proposal.ready",
  "run.completed",
  "run.canceled",
  "run.error",
] as const satisfies readonly FabricAiSseEventName[]);

export function isFabricAiSseEventName(value: string): value is FabricAiSseEventName {
  return (FABRIC_AI_SSE_EVENT_NAMES as readonly string[]).includes(value);
}

export type FabricAiSseEnvelope<Name extends FabricAiSseEventName = FabricAiSseEventName> = {
  protocolVersion: typeof FABRIC_AI_PROTOCOL_VERSION;
  runId: string;
  sequence: number;
  emittedAt: string;
  type: Name;
  payload: FabricAiSsePayloads[Name];
};

const encoder = new TextEncoder();

export function encodeFabricAiSseEnvelope<Name extends FabricAiSseEventName>(
  envelope: FabricAiSseEnvelope<Name>,
): Uint8Array {
  return encoder.encode(
    `id: ${envelope.sequence}\nevent: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`,
  );
}

export function encodeFabricAiKeepAlive(now = Date.now()): Uint8Array {
  return encoder.encode(`: keep-alive ${now}\n\n`);
}

export class FabricAiSseWriter {
  private sequence = 0;
  private closed = false;

  constructor(
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    private readonly runId: string,
  ) {}

  send<Name extends FabricAiSseEventName>(
    type: Name,
    payload: FabricAiSsePayloads[Name],
  ): boolean {
    if (this.closed) return false;
    const envelope: FabricAiSseEnvelope<Name> = {
      protocolVersion: FABRIC_AI_PROTOCOL_VERSION,
      runId: this.runId,
      sequence: ++this.sequence,
      emittedAt: new Date().toISOString(),
      type,
      payload,
    };

    try {
      this.controller.enqueue(encodeFabricAiSseEnvelope(envelope));
      return true;
    } catch {
      this.closed = true;
      return false;
    }
  }

  keepAlive(): void {
    if (this.closed) return;
    try {
      this.controller.enqueue(encodeFabricAiKeepAlive());
    } catch {
      this.closed = true;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller.close();
    } catch {
      // A disconnected client already closed the stream.
    }
  }
}

export const FABRIC_AI_SSE_HEADERS = Object.freeze({
  "Cache-Control": "private, no-cache, no-store, max-age=0, must-revalidate",
  "Content-Encoding": "identity",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
  Vary: "Cookie",
});
