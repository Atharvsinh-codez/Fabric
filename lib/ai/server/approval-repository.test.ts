import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/clients/web", () => ({
  db: { transaction: mocks.transaction },
}));

import { boards } from "@/db/schema/product";
import type { CanvasPatch } from "@/lib/ai/canvas-patch";
import { hashCanonicalJson } from "@/lib/ai/hash";

import { finalizeAiProposalApproval } from "./approval-repository";

const PRINCIPAL_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const BOARD_ID = "55555555-5555-4555-8555-555555555555";
const GENERATION_ID = "66666666-6666-4666-8666-666666666666";
const RUN_ID = "22222222-2222-4222-8222-222222222222";

const patch: CanvasPatch = {
  schemaVersion: 1,
  summary: "Add a planning note.",
  base: {
    workspaceId: WORKSPACE_ID,
    boardId: BOARD_ID,
    documentGenerationId: GENERATION_ID,
    durableSequence: 7,
  },
  operations: [{
    type: "createNode",
    tempId: "tmp_plan",
    nodeType: "note",
    position: { x: 40, y: 60 },
    size: { width: 240, height: 120 },
    content: { title: "Plan" },
  }],
};

function lockingSelect(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const forUpdate = vi.fn(() => ({ limit }));
  return {
    forUpdate,
    query: {
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: forUpdate })),
      })),
    },
  };
}

function membershipJoinedLockingSelect(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const forUpdate = vi.fn(() => ({ limit }));
  const joined = {
    leftJoin: vi.fn(),
    where: vi.fn(() => ({ for: forUpdate })),
  };
  joined.leftJoin.mockReturnValue(joined);
  return {
    forUpdate,
    query: { from: vi.fn(() => joined) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AI proposal approval repository", () => {
  it("locks only the board row across nullable membership joins and finalizes", async () => {
    const proposalHash = hashCanonicalJson(patch);
    const runLock = lockingSelect([{
      id: RUN_ID,
      status: "waiting_for_approval",
      workspaceId: WORKSPACE_ID,
      boardId: BOARD_ID,
      documentGenerationId: GENERATION_ID,
      baseDurableSequence: 7,
      proposal: patch,
      proposalHash,
      usage: {},
      lastEventSequence: 7,
      proposalReadyAt: new Date("2026-07-18T09:59:00.000Z"),
    }]);
    const boardLock = membershipJoinedLockingSelect([{
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      document: {
        version: 1,
        nodes: [{
          id: "tmp_plan",
          type: "note",
          title: "Plan",
          x: 40,
          y: 60,
          width: 240,
          height: 120,
          fill: "#ffffff",
        }],
        edges: [],
      },
      documentGenerationId: GENERATION_ID,
      revision: 8,
      ownerId: PRINCIPAL_ID,
      sharingPolicy: "private",
      archivedAt: null,
      workspaceRole: null,
      directRole: null,
      projectRole: null,
    }]);
    const updateWhere = vi.fn(async () => undefined);
    const transaction = {
      select: vi.fn()
        .mockReturnValueOnce(runLock.query)
        .mockReturnValueOnce(boardLock.query),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
      insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));
    const now = new Date("2026-07-18T10:00:00.000Z");

    await expect(finalizeAiProposalApproval(PRINCIPAL_ID, {
      runId: RUN_ID,
      patchHash: proposalHash,
      documentGenerationId: GENERATION_ID,
      baseDurableSequence: 7,
      observedDurableSequence: 8,
    }, now)).resolves.toMatchObject({
      run: {
        id: RUN_ID,
        status: "completed",
        appliedDurableSequence: 8,
        finalizedAt: now.toISOString(),
      },
    });

    expect(runLock.forUpdate).toHaveBeenCalledWith("update");
    expect(boardLock.forUpdate).toHaveBeenCalledWith("update", { of: boards });
    expect(transaction.update).toHaveBeenCalledTimes(2);
  });
});
