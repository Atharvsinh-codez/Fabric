import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AiProposalClientError,
  cancelAiProposal,
  finalizeAiProposal,
  streamAiProposal,
} from "./client";
import type { AiProposalRequest } from "./proposal-request";

const request: AiProposalRequest = {
  skill: "canvas-agent",
  workspaceId: "product-studio",
  boardId: "board-1",
  documentGenerationId: "document:board-1:local-v1",
  durableSequence: 0,
  instruction: "Cluster the notes by theme.",
  viewport: { x: 0, y: 0, width: 1_280, height: 720 },
  conversation: [],
  selection: [
    { id: "note-1", type: "note", title: "One", x: 0, y: 0, width: 120, height: 80 },
    { id: "note-2", type: "note", title: "Two", x: 140, y: 0, width: 120, height: 80 },
  ],
};

function eventRecord(type: string, sequence: number, payload: unknown) {
  return `id: ${sequence}\nevent: ${type}\ndata: ${JSON.stringify({
    protocolVersion: 1,
    runId: "run-1",
    sequence,
    emittedAt: "2026-07-13T12:00:00.000Z",
    type,
    payload,
  })}\n\n`;
}

function streamResponse(records: string[], runId?: string) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const record of records) {
          const splitAt = Math.max(1, Math.floor(record.length / 2));
          controller.enqueue(encoder.encode(record.slice(0, splitAt)));
          controller.enqueue(encoder.encode(record.slice(splitAt)));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        ...(runId ? { "X-Fabric-AI-Run-Id": runId } : {}),
      },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("streamAiProposal", () => {
  it("returns only a fully validated proposal.ready payload", async () => {
    const ready = {
      patch: {
        schemaVersion: 1,
        summary: "Group related notes.",
        base: {
          workspaceId: "product-studio",
          boardId: "board-1",
          documentGenerationId: "document:board-1:local-v1",
          durableSequence: 0,
        },
        operations: [
          {
            type: "moveNode",
            nodeId: "note-1",
            position: { x: 24, y: 32 },
          },
        ],
      },
      patchHash: "a".repeat(64),
      patchBytes: 512,
      affectedNodeIds: ["note-1"],
      riskClass: "low",
    };
    const onEvent = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          eventRecord("run.progress", 1, {
            phase: "calling_model",
            message: "Finding themes...",
          }),
          eventRecord("proposal.ready", 2, ready),
          eventRecord("run.completed", 3, { usage: {} }),
        ]),
      ),
    );

    await expect(
      streamAiProposal({
        request,
        signal: new AbortController().signal,
        onEvent,
      }),
    ).resolves.toEqual(ready);
    expect(onEvent).toHaveBeenCalledTimes(3);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("idempotency-key")).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it("returns a validated clarification without pretending a canvas patch exists", async () => {
    const clarification = {
      kind: "clarification",
      reason: "missing-selection",
      question: "Which cards should I organize?",
      choices: ["Use my current selection", "Create a new group"],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          eventRecord("clarification.ready", 1, clarification),
          eventRecord("run.completed", 2, { usage: { totalTokens: 12 } }),
        ]),
      ),
    );

    await expect(
      streamAiProposal({ request, signal: new AbortController().signal }),
    ).resolves.toEqual(clarification);
  });

  it("surfaces streamed rate limits as retryable safe errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          eventRecord("run.error", 1, {
            code: "rate_limited",
            message: "AI is busy. Try again shortly.",
            retryable: true,
          }),
        ]),
      ),
    );

    const promise = streamAiProposal({
      request,
      signal: new AbortController().signal,
    });
    await expect(promise).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    } satisfies Partial<AiProposalClientError>);
  });

  it("reconnects to the same durable run after an incomplete stream", async () => {
    const ready = {
      patch: {
        schemaVersion: 1,
        summary: "Group related notes.",
        base: {
          workspaceId: "product-studio",
          boardId: "board-1",
          documentGenerationId: "document:board-1:local-v1",
          durableSequence: 0,
        },
        operations: [
          { type: "moveNode", nodeId: "note-1", position: { x: 24, y: 32 } },
        ],
      },
      patchHash: "b".repeat(64),
      patchBytes: 512,
      affectedNodeIds: ["note-1"],
      riskClass: "low",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        streamResponse([
          eventRecord("run.progress", 1, {
            phase: "calling_model",
            message: "Finding themes...",
          }),
        ], "run-1"),
      )
      .mockResolvedValueOnce(
        streamResponse([eventRecord("proposal.ready", 2, ready)], "run-1"),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onRunId = vi.fn();

    await expect(
      streamAiProposal({
        request,
        signal: new AbortController().signal,
        onRunId,
      }),
    ).resolves.toEqual(ready);

    expect(onRunId).toHaveBeenCalledWith("run-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      "/api/ai/proposal?runId=run-1&after=1",
    );
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("last-event-id")).toBe("1");
  });

  it("marks the durable run canceled when the active mode is turned off", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return Response.json({ run: { canceled: true } });
      }
      return streamResponse([], "run-1");
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = streamAiProposal({
      request,
      signal: controller.signal,
      onRunId: () => {
        setTimeout(() => controller.abort(), 0);
      },
    });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ai/proposal?runId=run-1",
        expect.objectContaining({ method: "DELETE", keepalive: true }),
      );
    });
  });

  it("cancels a durable run through the authenticated mutation endpoint", async () => {
    const fetchMock = vi.fn(async () => Response.json({ run: { canceled: true } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cancelAiProposal("run-1")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/proposal?runId=run-1",
      expect.objectContaining({ method: "DELETE", credentials: "same-origin" }),
    );
  });

  it("finalizes an approval through the same-origin durable receipt endpoint", async () => {
    const approval = {
      runId: "22222222-2222-4222-8222-222222222222",
      patchHash: "a".repeat(64),
      documentGenerationId: "66666666-6666-4666-8666-666666666666",
      baseDurableSequence: 7,
      observedDurableSequence: 8,
    };
    const receipt = {
      run: {
        id: approval.runId,
        status: "completed",
        boardId: "55555555-5555-4555-8555-555555555555",
        documentGenerationId: approval.documentGenerationId,
        baseDurableSequence: 7,
        appliedDurableSequence: 8,
        finalizedAt: "2026-07-13T12:00:00.000Z",
      },
    };
    const fetchMock = vi.fn(async () => Response.json(receipt));
    vi.stubGlobal("fetch", fetchMock);

    await expect(finalizeAiProposal(approval)).resolves.toEqual(receipt);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/proposal/approval",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify(approval),
      }),
    );
  });
});
