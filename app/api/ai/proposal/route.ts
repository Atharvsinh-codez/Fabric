import { randomUUID } from "node:crypto";

import { z } from "zod";

import { requirePrincipal } from "@/lib/auth/require-principal";
import { parseIdempotencyKey } from "@/lib/ai/idempotency";
import { aiEventPollDelayMs } from "@/lib/ai/event-poll-policy";
import { AiProposalRequestSchema } from "@/lib/ai/proposal-request";
import { isSettledAiStreamStatus } from "@/lib/ai/run-state";
import {
  authorizeProposalSnapshot,
  createOrReuseAiRun,
  getOwnedAiRun,
  listOwnedAiRunEvents,
  recordAiRunDispatchFailure,
  requestAiRunCancellation,
} from "@/lib/ai/server/run-repository";
import {
  encodeFabricAiKeepAlive,
  encodeFabricAiSseEnvelope,
  FABRIC_AI_SSE_HEADERS,
  isFabricAiSseEventName,
} from "@/lib/ai/sse";
import {
  apiJson,
  BoardApiError,
  handleApiError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/boards/http";
import { dispatchAiRunOnDemand } from "@/worker/serverless-dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The v2 planner is bounded to 60 seconds. Keep a wider function envelope for
// dispatch, persisted SSE polling, reconnects, and backward-compatible runs.
export const maxDuration = 300;

const MAX_REQUEST_BYTES = 64 * 1_024;
const RunIdSchema = z.string().uuid();
const ProductionIdsSchema = z
  .object({
    workspaceId: z.string().uuid(),
    boardId: z.string().uuid(),
    documentGenerationId: z.string().uuid(),
  })
  .passthrough();

function requireAiEnabled(): void {
  if (process.env.AI_RUNS_ENABLED?.toLowerCase() !== "true") {
    throw new BoardApiError(503, "ai_disabled", "Fabric AI is temporarily disabled.");
  }
}

function parseRunId(request: Request): string {
  const parsed = RunIdSchema.safeParse(new URL(request.url).searchParams.get("runId"));
  if (!parsed.success) throw new BoardApiError(422, "invalid_run_id", "A valid AI run ID is required.");
  return parsed.data;
}

function parseAfterSequence(request: Request): number {
  const url = new URL(request.url);
  const raw = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0";
  const sequence = Number(raw.includes(":") ? raw.slice(raw.lastIndexOf(":") + 1) : raw);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new BoardApiError(422, "invalid_event_sequence", "The AI event cursor is invalid.");
  }
  return sequence;
}

function persistedEventStream(
  principalId: string,
  runId: string,
  initialSequence: number,
  requestSignal: AbortSignal,
  dispatchPromise: Promise<void>,
): ReadableStream<Uint8Array> {
  let stopped = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let sequence = initialSequence;
      let lastKeepAliveAt = Date.now();
      let consecutiveEmptyPolls = 0;
      const stop = () => {
        stopped = true;
      };
      requestSignal.addEventListener("abort", stop, { once: true });

      try {
        while (!stopped) {
          const batch = await listOwnedAiRunEvents(principalId, runId, sequence);
          for (const event of batch.events) {
            if (!isFabricAiSseEventName(event.type)) {
              throw new Error("The AI run contains an unsupported event type.");
            }
            controller.enqueue(
              encodeFabricAiSseEnvelope({
                protocolVersion: 1,
                runId: event.runId,
                sequence: event.sequence,
                emittedAt: event.createdAt.toISOString(),
                type: event.type,
                payload: event.payload,
              }),
            );
            sequence = event.sequence;
          }

          consecutiveEmptyPolls = batch.events.length === 0
            ? consecutiveEmptyPolls + 1
            : 0;

          if (isSettledAiStreamStatus(batch.status) && batch.events.length === 0) break;
          if (Date.now() - lastKeepAliveAt >= 15_000) {
            controller.enqueue(encodeFabricAiKeepAlive());
            lastKeepAliveAt = Date.now();
          }
          await new Promise((resolve) =>
            setTimeout(resolve, aiEventPollDelayMs(consecutiveEmptyPolls)),
          );
        }
      } catch {
        // Durable errors are written by the worker. Infrastructure failures close
        // this connection so the authenticated client can reconnect by run ID.
      } finally {
        await dispatchPromise;
        requestSignal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // The browser may already have closed the connection.
        }
      }
    },
    cancel() {
      stopped = true;
    },
  });
}

function streamResponse(
  principalId: string,
  runId: string,
  afterSequence: number,
  signal: AbortSignal,
  dispatchOnDemand = false,
): Response {
  const dispatchPromise = dispatchOnDemand
    ? dispatchAiRunOnDemand(runId).catch(async () => {
      await recordAiRunDispatchFailure(principalId, runId).catch(() => false);
    })
    : Promise.resolve();
  const headers = new Headers(FABRIC_AI_SSE_HEADERS);
  headers.set("X-Fabric-AI-Run-Id", runId);
  return new Response(persistedEventStream(
    principalId,
    runId,
    afterSequence,
    signal,
    dispatchPromise,
  ), {
    status: 200,
    headers,
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    requireAiEnabled();
    const principal = await requirePrincipal();
    const body = await readJsonBody(request, MAX_REQUEST_BYTES);
    const parsed = AiProposalRequestSchema.safeParse(body);
    if (!parsed.success || !ProductionIdsSchema.safeParse(parsed.data).success) {
      throw new BoardApiError(422, "invalid_request", "The proposal request failed validation.");
    }

    const suppliedKey = request.headers.get("idempotency-key");
    const idempotencyKey = suppliedKey === null ? randomUUID() : parseIdempotencyKey(suppliedKey);
    if (!idempotencyKey) {
      throw new BoardApiError(
        422,
        "invalid_idempotency_key",
        "The idempotency key must contain 8–128 safe characters.",
      );
    }

    const canonicalRequest = await authorizeProposalSnapshot(principal.id, parsed.data);
    const run = await createOrReuseAiRun({
      principalId: principal.id,
      request: canonicalRequest,
      idempotencyKey,
    });
    return streamResponse(principal.id, run.runId, 0, request.signal, true);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    requireAiEnabled();
    const principal = await requirePrincipal();
    const runId = parseRunId(request);
    await getOwnedAiRun(principal.id, runId);
    return streamResponse(principal.id, runId, parseAfterSequence(request), request.signal, true);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const principal = await requirePrincipal();
    const result = await requestAiRunCancellation(principal.id, parseRunId(request));
    return apiJson({ run: result });
  } catch (error) {
    return handleApiError(error);
  }
}
