import { describe, expect, it } from "vitest";

import type { CanvasPatch } from "./canvas-patch";
import {
  AiProposalApprovalRequestSchema,
  verifyApprovedPatchProjection,
} from "./approval";

const patch: CanvasPatch = {
  schemaVersion: 1,
  summary: "Group the research notes.",
  base: {
    workspaceId: "44444444-4444-4444-8444-444444444444",
    boardId: "55555555-5555-4555-8555-555555555555",
    documentGenerationId: "66666666-6666-4666-8666-666666666666",
    durableSequence: 7,
  },
  operations: [
    {
      type: "createNode",
      tempId: "tmp_theme",
      nodeType: "frame",
      position: { x: 40, y: 40 },
      size: { width: 640, height: 420 },
      content: { title: "Theme" },
      appearance: { fill: "fog" },
    },
    {
      type: "moveNode",
      nodeId: "node_1",
      position: { x: 80, y: 110 },
      parentId: "tmp_theme",
    },
    {
      type: "moveNode",
      nodeId: "node_2",
      position: { x: 320, y: 110 },
      parentId: "tmp_theme",
    },
  ],
};

const reflectedDocument = {
  nodes: [
    {
      id: "tmp_theme",
      type: "frame" as const,
      title: "Theme",
      x: 40,
      y: 40,
      width: 640,
      height: 420,
      fill: "#64748b",
    },
    {
      id: "node_1",
      type: "note" as const,
      title: "One",
      x: 80,
      y: 110,
      width: 200,
      height: 120,
      fill: "#ffffff",
      parentId: "tmp_theme",
    },
    {
      id: "node_2",
      type: "note" as const,
      title: "Two",
      x: 320,
      y: 110,
      width: 200,
      height: 120,
      fill: "#ffffff",
      parentId: "tmp_theme",
    },
  ],
  edges: [],
};

describe("AI approval binding", () => {
  it("accepts a strict run, patch, generation, base, and durable checkpoint binding", () => {
    expect(
      AiProposalApprovalRequestSchema.safeParse({
        runId: "22222222-2222-4222-8222-222222222222",
        patchHash: "a".repeat(64),
        documentGenerationId: patch.base.documentGenerationId,
        baseDurableSequence: 7,
        observedDurableSequence: 8,
      }).success,
    ).toBe(true);
    expect(
      AiProposalApprovalRequestSchema.safeParse({
        runId: "22222222-2222-4222-8222-222222222222",
        patchHash: "a".repeat(64),
        documentGenerationId: patch.base.documentGenerationId,
        baseDurableSequence: 7,
        observedDurableSequence: 8,
        boardId: patch.base.boardId,
      }).success,
    ).toBe(false);
  });

  it("verifies the exact approved create and move results in the stored projection", () => {
    expect(verifyApprovedPatchProjection(patch, reflectedDocument)).toEqual({ ok: true });
  });

  it("rejects a lookalike projection without the auditable temporary id", () => {
    const lookalike = structuredClone(reflectedDocument);
    lookalike.nodes[0]!.id = "unrelated_frame";
    expect(verifyApprovedPatchProjection(patch, lookalike)).toEqual({
      ok: false,
      issueCodes: ["missing_created_node"],
    });
  });

  it("rejects stale positions or parent relationships", () => {
    const stale = structuredClone(reflectedDocument);
    stale.nodes[1]!.x = 81;
    stale.nodes[2]!.parentId = "another_frame";
    expect(verifyApprovedPatchProjection(patch, stale)).toEqual({
      ok: false,
      issueCodes: ["moved_node_mismatch"],
    });
  });
});
