import { describe, expect, it } from "vitest";

import { CanvasPatchSchema, type CanvasPatch } from "./canvas-patch";
import { validateCanvasPatchSemantics } from "./semantic-validator";

const base = {
  workspaceId: "workspace_1",
  boardId: "board_1",
  documentGenerationId: "generation_1",
  durableSequence: 12,
  selectionHash: "a".repeat(64),
} as const;

const patch: CanvasPatch = {
  schemaVersion: 1,
  summary: "Grouped the research notes into a trust theme.",
  base,
  operations: [
    {
      type: "createNode",
      tempId: "tmp_trust",
      nodeType: "frame",
      position: { x: 40, y: 40 },
      size: { width: 640, height: 420 },
      content: { title: "Trust and confidence" },
      appearance: { fill: "fog" },
    },
    {
      type: "moveNode",
      nodeId: "node_1",
      position: { x: 80, y: 110 },
      parentId: "tmp_trust",
    },
    {
      type: "moveNode",
      nodeId: "node_2",
      position: { x: 320, y: 110 },
      parentId: "tmp_trust",
    },
  ],
};

const context = {
  base,
  nodes: [
    { id: "node_1", type: "note" as const, width: 200, height: 120 },
    { id: "node_2", type: "note" as const, width: 200, height: 120 },
  ],
  allowedOperations: ["createNode", "moveNode"] as const,
  allowedCreatedNodeTypes: ["frame"] as const,
  limits: { maxPatchBytes: 64 * 1_024, maxOperations: 48, maxAffectedNodes: 60 },
};

describe("CanvasPatch", () => {
  it("accepts a strict, bounded cluster proposal", () => {
    expect(CanvasPatchSchema.safeParse(patch).success).toBe(true);
    expect(validateCanvasPatchSemantics(patch, context)).toMatchObject({
      ok: true,
      affectedNodeIds: ["node_1", "node_2", "tmp_trust"],
      riskClass: "low",
    });
  });

  it("rejects undeclared operation fields", () => {
    const unsafe = structuredClone(patch) as unknown as Record<string, unknown>;
    const operations = unsafe.operations as Array<Record<string, unknown>>;
    operations[0].style = { css: "position:fixed" };
    expect(CanvasPatchSchema.safeParse(unsafe).success).toBe(false);
  });

  it("allows image sources but rejects every image creation operation", () => {
    const imageCreation = {
      ...patch,
      operations: [
        {
          type: "createNode",
          tempId: "tmp_image",
          nodeType: "image",
          position: { x: 40, y: 40 },
          size: { width: 320, height: 180 },
          content: { title: "Generated image" },
        },
      ],
    };
    expect(CanvasPatchSchema.safeParse(imageCreation).success).toBe(false);
  });

  it.each(["diamond", "triangle", "hexagon"] as const)(
    "accepts an editable native %s diagram node",
    (nodeType) => {
      expect(
        CanvasPatchSchema.safeParse({
          ...patch,
          operations: [
            {
              type: "createNode",
              tempId: `tmp_${nodeType}`,
              nodeType,
              position: { x: 80, y: 80 },
              size: { width: 180, height: 120 },
              content: { title: nodeType },
            },
          ],
        }).success,
      ).toBe(true);
    },
  );

  it("accepts bounded pen text and drawing operations", () => {
    expect(
      CanvasPatchSchema.safeParse({
        ...patch,
        operations: [
          {
            type: "writeText",
            tempId: "tmp_answer",
            position: { x: 100, y: 100 },
            text: "x + 2 = 7\nx = 5",
            fontSize: 28,
            maxWidth: 480,
          },
          {
            type: "createDrawing",
            tempId: "tmp_mark",
            position: { x: 100, y: 220 },
            segments: [
              {
                type: "straight",
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 40 },
                ],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("rejects stale bases and nodes outside the authorized snapshot", () => {
    const stale: CanvasPatch = {
      ...patch,
      base: { ...base, durableSequence: 11 },
      operations: [
        {
          type: "moveNode",
          nodeId: "node_outside_selection",
          position: { x: 0, y: 0 },
        },
      ],
    };
    const result = validateCanvasPatchSemantics(stale, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toEqual(
        expect.arrayContaining(["base_mismatch", "unknown_node"]),
      );
    }
  });

  it("rejects operations outside the active skill manifest", () => {
    const destructive: CanvasPatch = {
      ...patch,
      operations: [{ type: "deleteNode", nodeId: "node_1" }],
    };
    const result = validateCanvasPatchSemantics(destructive, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("operation_not_allowed");
    }
  });

  it("rejects a skill creating an undeclared node kind", () => {
    const frameOperation = patch.operations[0];
    if (frameOperation.type !== "createNode") throw new Error("Invalid test fixture");
    const createsNote: CanvasPatch = {
      ...patch,
      operations: [{ ...frameOperation, nodeType: "note" }],
    };
    const result = validateCanvasPatchSemantics(createsNote, context);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.code)).toContain("node_type_not_allowed");
    }
  });
});
