import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FabricModelProvider } from "../lib/ai/contracts";
import { buildAuthorizedBoardScene } from "../lib/ai/engine/authorized-scene";

const repository = vi.hoisted(() => ({
  readBaseSnapshotStatus: vi.fn(),
  readAiRunControl: vi.fn(),
  recordClarificationReady: vi.fn(),
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
  skillVersion: "2.0.0",
  promptVersion: "canvas-agent.plan.v6",
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

function providerOutput(output: unknown, usage = { totalTokens: 42 }): FabricModelProvider {
  return {
    provider: "openai-compatible",
    model: "gcli/grok-4.5-medium",
    async createTurn() {
      return {
        events: (async function* () {
          yield { type: "interaction_started" as const, interactionId: "interaction-1" };
          yield { type: "text_delta" as const, text: JSON.stringify(output) };
          yield { type: "interaction_completed" as const, usage };
        })(),
      };
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  repository.readBaseSnapshotStatus.mockReset().mockResolvedValue("current");
  repository.readAiRunControl.mockResolvedValue({
    status: "queued",
    cancelRequestedAt: null,
    deadlineAt: job.deadlineAt,
  });
  repository.recordRunProgress.mockResolvedValue(true);
  repository.recordProposalReady.mockResolvedValue(true);
  repository.recordClarificationReady.mockResolvedValue(true);
  repository.refreshAiJobLease.mockResolvedValue(true);
});

describe("durable AI processor v2", () => {
  it("rejects a stale board scope or generation before invoking the provider", async () => {
    repository.readBaseSnapshotStatus.mockResolvedValueOnce("stale");
    const createTurn = vi.fn();
    const provider: FabricModelProvider = {
      provider: "openai-compatible",
      model: job.model,
      createTurn,
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider,
      leaseMs: 60_000,
    });

    expect(createTurn).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "stale_generation",
        error: expect.objectContaining({ code: "stale_generation" }),
      }),
    );
  });

  it("compiles a semantic BoardPlan into an ordered native CanvasPatch", async () => {
    const plan = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Grouped the selected notes and added a review flow.",
      placement: "selection-below",
      flow: "vertical",
      actions: [
        {
          kind: "arrangeSelection",
          selectionRefs: ["s1", "s2"],
          arrangement: "row",
          spacing: "comfortable",
        },
        {
          kind: "addDiagram",
          key: "review_flow",
          title: "Review flow",
          layout: "flow-horizontal",
          nodes: [
            { key: "draft", shape: "note", label: "Draft" },
            { key: "review", shape: "diamond", label: "Review" },
          ],
          connections: [{ from: "draft", to: "review" }],
        },
      ],
    };
    let observedTurn: Parameters<FabricModelProvider["createTurn"]>[0] | undefined;
    let observedImages: unknown;
    const baseProvider = providerOutput(plan);
    const provider: FabricModelProvider = {
      ...baseProvider,
      async createTurn(turn) {
        observedTurn = turn;
        observedImages = turn.images;
        return baseProvider.createTurn(turn);
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
      media: { baseUrl: "https://fabric.example.test", signingKey: "m".repeat(64) },
      buildModelImages,
    });

    expect(repository.recordProposalReady).toHaveBeenCalledOnce();
    const stored = repository.recordProposalReady.mock.calls[0]?.[1];
    expect(stored).toMatchObject({
      job,
      proposal: {
        patch: {
          schemaVersion: 1,
          summary: plan.summary,
          base: {
            workspaceId: job.workspaceId,
            boardId: job.boardId,
            documentGenerationId: job.documentGenerationId,
            durableSequence: job.baseDurableSequence,
            selectionHash,
          },
        },
        patchHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      usage: { totalTokens: 42 },
    });
    const operations = stored?.proposal.patch.operations as Array<Record<string, unknown>>;
    expect(operations.map((operation) => operation.type)).toEqual([
      "moveNode",
      "moveNode",
      "createNode",
      "createNode",
      "createNode",
      "createConnector",
    ]);
    expect(observedTurn?.maxOutputTokens).toBe(4_096);
    expect(JSON.stringify(observedTurn?.responseSchema)).toContain('"const":"proposal"');
    expect(JSON.stringify(observedTurn?.responseSchema)).not.toContain("workspaceId");
    expect(observedTurn?.input).not.toContain(job.workspaceId);
    expect(observedImages).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/signed-preview",
        detail: "high",
      }),
    ]);
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
  });

  it("keeps a self-contained additive proposal when the same generation advances", async () => {
    repository.readBaseSnapshotStatus
      .mockResolvedValueOnce("advanced")
      .mockResolvedValueOnce("advanced");
    const plan = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Added a standalone review workflow.",
      placement: "viewport-center",
      flow: "horizontal",
      actions: [{
        kind: "addDiagram",
        key: "review_flow",
        title: "Review flow",
        layout: "flow-horizontal",
        nodes: [
          { key: "draft", shape: "note", label: "Draft" },
          { key: "review", shape: "diamond", label: "Review" },
        ],
        connections: [{ from: "draft", to: "review" }],
      }],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(plan),
      leaseMs: 60_000,
    });

    expect(repository.recordProposalReady).toHaveBeenCalledOnce();
    expect(repository.recordProposalReady.mock.calls[0]?.[1]).toMatchObject({
      proposal: {
        patch: {
          base: { durableSequence: job.baseDurableSequence },
          operations: [
            { type: "createNode" },
            { type: "createNode" },
            { type: "createNode" },
            { type: "createConnector" },
          ],
        },
      },
    });
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
  });

  it("rejects a mutation proposal when the same generation advances", async () => {
    repository.readBaseSnapshotStatus
      .mockResolvedValueOnce("current")
      .mockResolvedValueOnce("advanced");
    const plan = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Renamed a selected note.",
      placement: "selection-below",
      flow: "vertical",
      actions: [{
        kind: "editSelection",
        edits: [{ selectionRef: "s1", title: "Updated title" }],
      }],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(plan),
      leaseMs: 60_000,
    });

    expect(repository.recordProposalReady).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "stale_generation",
        usage: expect.objectContaining({
          fabric: expect.objectContaining({ compiledOperationCount: 1 }),
        }),
        error: expect.objectContaining({ code: "stale_generation" }),
      }),
    );
  });

  it("returns a clarification after a same-generation revision advance", async () => {
    repository.readBaseSnapshotStatus
      .mockResolvedValueOnce("current")
      .mockResolvedValueOnce("advanced");
    const clarification = {
      schemaVersion: 1,
      kind: "clarification",
      reason: "ambiguous",
      question: "Should the workflow cover review or publishing?",
      choices: ["Review", "Publishing"],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(clarification),
      leaseMs: 60_000,
    });

    expect(repository.recordClarificationReady).toHaveBeenCalledOnce();
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
  });

  it("rejects a clarification after the board scope or generation becomes stale", async () => {
    repository.readBaseSnapshotStatus
      .mockResolvedValueOnce("current")
      .mockResolvedValueOnce("stale");
    const clarification = {
      schemaVersion: 1,
      kind: "clarification",
      reason: "ambiguous",
      question: "Which workflow should I create?",
      choices: ["Review", "Publishing"],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(clarification),
      leaseMs: 60_000,
    });

    expect(repository.recordClarificationReady).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "stale_generation",
        error: expect.objectContaining({ code: "stale_generation" }),
      }),
    );
  });

  it("repairs harmless provider schema drift without losing plan content", async () => {
    const blocks = Array.from({ length: 13 }, (_, index) => ({
      role: "body",
      text: `Plan step ${index + 1}`,
    }));
    const candidate = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create the complete product plan.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "composeText",
          key: "product_plan",
          blocks,
        },
        {
          kind: "addDiagram",
          key: "delivery_flow",
          layout: "flow-horizontal",
          nodes: [
            { key: "discover", label: "Discover" },
            { key: "launch", shape: "rectangle", label: "Launch" },
          ],
          connections: [{ from: "discover", to: "launch", label: "" }],
        },
      ],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(candidate),
      leaseMs: 60_000,
    });

    expect(repository.recordProposalReady).toHaveBeenCalledOnce();
    const stored = repository.recordProposalReady.mock.calls[0]?.[1];
    expect(stored?.usage).toMatchObject({
      fabric: { planCompatibilityMode: "safe_defaults_and_batches_v1" },
    });
    const operations = stored?.proposal.patch.operations as Array<Record<string, unknown>>;
    const createdText = operations.filter(
      (operation) => operation.type === "createNode" && operation.nodeType === "summary",
    );
    expect(createdText).toHaveLength(13);
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
  });

  it("validates empty-selection mutations against the authorized durable viewport scene", async () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [{
          id: "visible_note",
          type: "note",
          title: "Rough title",
          x: 120,
          y: 100,
          width: 220,
          height: 140,
          fill: "yellow",
        }],
        edges: [],
      },
      selection: [],
      viewport: { x: 0, y: 0, width: 900, height: 600 },
    });
    const visibleJob = {
      ...job,
      executionInput: {
        ...job.executionInput,
        instruction: "Rename the visible note clearly.",
        selection: [],
        viewport: scene.viewport,
        scene,
      },
    };
    const plan = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Renamed the visible note.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "editSelection",
        edits: [{ selectionRef: "v1", title: "Clear title" }],
      }],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job: visibleJob,
      provider: providerOutput(plan),
      leaseMs: 60_000,
    });

    expect(repository.recordProposalReady).toHaveBeenCalledOnce();
    expect(repository.recordProposalReady.mock.calls[0]?.[1]).toMatchObject({
      proposal: {
        patch: {
          operations: [{
            type: "updateNode",
            nodeId: "visible_note",
            content: { title: "Clear title" },
          }],
        },
        affectedNodeIds: ["visible_note"],
      },
    });
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
  });

  it("rejects a hallucinated writable handle omitted from the bounded model context", async () => {
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      id: `visible_${String(index).padStart(2, "0")}`,
      type: "note" as const,
      title: `Visible ${index}`,
      body: `${index}: ${"large durable context ".repeat(80)}`,
      x: 40 + index * 120,
      y: 100,
      width: 100,
      height: 100,
      fill: "yellow",
    }));
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes, edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 4_000, height: 600 },
    });
    const visibleJob = {
      ...job,
      executionInput: {
        ...job.executionInput,
        instruction: "Rename the visible notes.",
        selection: [],
        viewport: scene.viewport,
        scene,
      },
    };
    const plan = {
      schemaVersion: 1,
      kind: "proposal",
      summary: "Renamed an omitted note.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "editSelection",
        edits: [{ selectionRef: "v21", title: "Hallucinated target" }],
      }],
    };
    let observedInput = "";
    const baseProvider = providerOutput(plan);
    const provider: FabricModelProvider = {
      ...baseProvider,
      async createTurn(turn) {
        observedInput = turn.input;
        return baseProvider.createTurn(turn);
      },
    };

    await processClaimedAiJob({
      sql: {} as never,
      job: visibleJob,
      provider,
      leaseMs: 60_000,
    });

    expect(observedInput).not.toContain('"handle":"v21"');
    expect(observedInput).not.toContain('"v21"');
    expect(repository.recordProposalReady).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "validation_failed",
        usage: expect.objectContaining({
          fabric: expect.objectContaining({
            sceneNodesOmitted: 5,
            sceneTextCharactersOmitted: expect.any(Number),
          }),
        }),
        error: expect.objectContaining({
          code: "semantic_validation_failed",
          issueCodes: ["unknown_selection_reference"],
        }),
      }),
    );
    const failureUsage = repository.recordRunFailure.mock.calls[0]?.[1]?.usage;
    expect(failureUsage?.fabric?.sceneTextCharactersOmitted).toBeGreaterThan(0);
  });

  it("completes a clarification without creating or applying a canvas patch", async () => {
    const clarification = {
      schemaVersion: 1,
      kind: "clarification",
      reason: "missing-selection",
      question: "Which notes should I organize?",
      choices: ["Use my current selection", "Create new notes"],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(clarification, { totalTokens: 18 }),
      leaseMs: 60_000,
    });

    expect(repository.recordClarificationReady).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        job,
        clarification: {
          kind: "clarification",
          reason: "missing-selection",
          question: "Which notes should I organize?",
          choices: clarification.choices,
        },
        usage: expect.objectContaining({
          totalTokens: 18,
          fabric: expect.objectContaining({
            engineVersion: "board-plan.v1",
            planActionCount: 0,
            compiledOperationCount: 0,
          }),
        }),
        responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(repository.recordProposalReady).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).not.toHaveBeenCalled();
  });

  it("rejects a provider-authored low-level CanvasPatch", async () => {
    const unsafePatch = {
      schemaVersion: 1,
      summary: "Bypassed the planner.",
      base: {
        workspaceId: job.workspaceId,
        boardId: job.boardId,
        documentGenerationId: job.documentGenerationId,
        durableSequence: job.baseDurableSequence,
        selectionHash,
      },
      operations: [
        {
          type: "createNode",
          tempId: "tmp_model",
          nodeType: "image",
          position: { x: 80, y: 110 },
          size: { width: 320, height: 240 },
          content: { title: "Generated image" },
        },
      ],
    };

    await processClaimedAiJob({
      sql: {} as never,
      job,
      provider: providerOutput(unsafePatch),
      leaseMs: 60_000,
    });

    expect(repository.recordProposalReady).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "validation_failed",
        responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        usage: expect.objectContaining({
          fabric: expect.objectContaining({
            modelInputBytes: expect.any(Number),
            outputBytes: expect.any(Number),
          }),
        }),
        error: expect.objectContaining({ code: "invalid_model_output" }),
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
        error: expect.objectContaining({ code: "provider_misconfigured", retryable: false }),
      }),
    );
  });

  it("fails closed when a queued run belongs to an older agent contract", async () => {
    const createTurn = vi.fn();
    const provider: FabricModelProvider = {
      provider: "openai-compatible",
      model: job.model,
      createTurn,
    };

    await processClaimedAiJob({
      sql: {} as never,
      job: { ...job, skillVersion: "1.0.0", promptVersion: "board-solve.prompt.v1" },
      provider,
      leaseMs: 60_000,
    });

    expect(createTurn).not.toHaveBeenCalled();
    expect(repository.recordRunFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "provider_unavailable",
        error: expect.objectContaining({ code: "provider_error", retryable: true }),
      }),
    );
  });
});
