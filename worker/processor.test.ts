import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FabricModelProvider } from "../lib/ai/contracts";

const repository = vi.hoisted(() => ({
  baseSnapshotIsCurrent: vi.fn(),
  readAiRunControl: vi.fn(),
  recordProposalDelta: vi.fn(),
  recordProposalReady: vi.fn(),
  recordProviderInteractionId: vi.fn(),
  recordRunCanceled: vi.fn(),
  recordRunFailure: vi.fn(),
  recordRunProgress: vi.fn(),
  refreshAiJobLease: vi.fn(),
  releaseAiJobForRetry: vi.fn(),
}));

vi.mock("./repository", () => repository);

import { processClaimedAiJob } from "./processor";

const selectionHash = "a".repeat(64);
const job = {
  jobId: "11111111-1111-4111-8111-111111111111",
  providerKeyOrdinal: 1,
  runId: "22222222-2222-4222-8222-222222222222",
  leaseOwner: "worker-1",
  attempt: 1,
  maxAttempts: 1,
  runStatus: "queued" as const,
  provider: "openai-compatible",
  model: "gcli/grok-4.5-medium",
  principalId: "33333333-3333-4333-8333-333333333333",
  workspaceId: "44444444-4444-4444-8444-444444444444",
  boardId: "55555555-5555-4555-8555-555555555555",
  documentGenerationId: "66666666-6666-4666-8666-666666666666",
  baseDurableSequence: 7,
  selectionHash,
  executionInput: {
    skill: "canvas-agent" as const,
    workspaceId: "44444444-4444-4444-8444-444444444444",
    boardId: "55555555-5555-4555-8555-555555555555",
    documentGenerationId: "66666666-6666-4666-8666-666666666666",
    durableSequence: 7,
    instruction: "Cluster these notes by theme.",
    selection: [
      { id: "node_1", type: "note" as const, title: "One", x: 0, y: 0, width: 200, height: 120 },
      { id: "node_2", type: "note" as const, title: "Two", x: 220, y: 0, width: 200, height: 120 },
    ],
    viewport: { x: -100, y: -80, width: 1280, height: 720 },
    conversation: [],
  },
  deadlineAt: new Date(Date.now() + 30_000),
};

beforeEach(() => {
  vi.clearAllMocks();
  repository.baseSnapshotIsCurrent.mockResolvedValue(true);
  repository.readAiRunControl.mockResolvedValue({
    status: "queued",
    cancelRequestedAt: null,
    deadlineAt: job.deadlineAt,
  });
  repository.recordRunProgress.mockResolvedValue(true);
  repository.recordProposalDelta.mockResolvedValue(true);
  repository.recordProposalReady.mockResolvedValue(true);
  repository.refreshAiJobLease.mockResolvedValue(true);
});

describe("durable AI processor", () => {
  it("persists only a validated proposal ready for approval", async () => {
    const patch = {
      schemaVersion: 1 as const,
      summary: "Grouped two notes into one theme.",
      base: {
        workspaceId: job.workspaceId,
        boardId: job.boardId,
        documentGenerationId: job.documentGenerationId,
        durableSequence: job.baseDurableSequence,
        selectionHash,
      },
      operations: [
        {
          type: "createNode" as const,
          tempId: "tmp_theme",
          nodeType: "frame" as const,
          position: { x: 40, y: 40 },
          size: { width: 640, height: 420 },
          content: { title: "Theme" },
          appearance: { fill: "fog" as const },
        },
        {
          type: "moveNode" as const,
          nodeId: "node_1",
          position: { x: 80, y: 110 },
          parentId: "tmp_theme",
        },
        {
          type: "moveNode" as const,
          nodeId: "node_2",
          position: { x: 320, y: 110 },
          parentId: "tmp_theme",
        },
      ],
    };
    let observedImages: unknown;
    const provider: FabricModelProvider = {
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
      async createTurn(turn) {
        observedImages = turn.images;
        return {
          events: (async function* () {
            yield { type: "interaction_started" as const, interactionId: "interaction-1" };
            for (const text of JSON.stringify(patch)) {
              yield { type: "text_delta" as const, text };
            }
            yield { type: "interaction_completed" as const, usage: { totalTokens: 42 } };
          })(),
        };
      },
    };

    const buildModelImages = vi.fn().mockResolvedValue([
      {
        url: "https://fabric.example.test/api/ai/media/signed-preview",
        label: "Authorized drawing preview.",
        detail: "high" as const,
      },
    ]);
    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider,
      leaseMs: 60_000,
      media: {
        baseUrl: "https://fabric.example.test",
        signingKey: "m".repeat(64),
      },
      buildModelImages,
    });

    expect(repository.recordProposalReady).toHaveBeenCalledOnce();
    expect(repository.recordProposalReady.mock.calls[0]?.[1]).toMatchObject({
      job,
      proposal: { patch, patchHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      usage: { totalTokens: 42 },
    });
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
    expect(repository.recordRunCanceled).not.toHaveBeenCalled();
    expect(buildModelImages).toHaveBeenCalledWith(
      expect.objectContaining({ job, request: job.executionInput }),
    );
    expect(observedImages).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/signed-preview",
        detail: "high",
      }),
    ]);
    expect(repository.recordProposalDelta).toHaveBeenCalledTimes(2);
    expect(
      repository.recordProposalDelta.mock.calls
        .map((call) => call[2])
        .join(""),
    ).toBe(JSON.stringify(patch));
  });

  it("uses the canvas agent contract and rejects image creation", async () => {
    const canvasJob = {
      ...job,
      executionInput: {
        ...job.executionInput,
        instruction: "Generate an image of this idea.",
      },
    };
    const unsafePatch = {
      schemaVersion: 1 as const,
      summary: "Tried to create a raster image.",
      base: {
        workspaceId: job.workspaceId,
        boardId: job.boardId,
        documentGenerationId: job.documentGenerationId,
        durableSequence: job.baseDurableSequence,
        selectionHash,
      },
      operations: [
        {
          type: "createNode" as const,
          tempId: "tmp_image",
          nodeType: "image" as const,
          position: { x: 80, y: 110 },
          size: { width: 320, height: 240 },
          content: { title: "Generated image" },
        },
      ],
    };
    const provider: FabricModelProvider = {
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
      async createTurn(turn) {
        expect(turn.systemInstruction).toContain("canvas-agent");
        expect(JSON.parse(turn.input)).toMatchObject({
          viewport: job.executionInput.viewport,
          outputRules: { imageCreationAllowed: false, rasterOutputAllowed: false },
        });
        expect(JSON.parse(turn.input)).not.toHaveProperty("assistanceMode");
        expect(turn.keyRotationOrdinal).toBe(job.providerKeyOrdinal - 1);
        return {
          events: (async function* () {
            yield { type: "text_delta" as const, text: JSON.stringify(unsafePatch) };
            yield { type: "interaction_completed" as const, usage: {} };
          })(),
        };
      },
    };

    await processClaimedAiJob({
      sql: {} as never,
      job: canvasJob,
      provider,
      leaseMs: 60_000,
    });

    expect(repository.recordProposalReady).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "validation_failed",
        error: expect.objectContaining({
          code: "invalid_model_output",
        }),
      }),
    );
  });

  it("fails closed before provider invocation when the queued model differs", async () => {
    const createTurn = vi.fn();
    const provider: FabricModelProvider = {
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
      createTurn,
    };

    await processClaimedAiJob({
      sql: {} as never,
      job: { ...job, model: "other/model" },
      provider,
      leaseMs: 60_000,
    });

    expect(createTurn).not.toHaveBeenCalled();
    expect(repository.recordRunProgress).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "provider_unavailable",
        error: expect.objectContaining({
          code: "provider_misconfigured",
          retryable: false,
        }),
      }),
    );
  });

});
