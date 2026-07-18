import { describe, expect, it } from "vitest";

import type { CanvasPatch, CanvasOperation } from "./canvas-patch";
import { isSelfContainedAdditivePatch } from "./patch-concurrency";

const patchBase: CanvasPatch["base"] = {
  workspaceId: "workspace-1",
  boardId: "board-1",
  documentGenerationId: "generation-1",
  durableSequence: 7,
};

function patch(operations: CanvasOperation[]): CanvasPatch {
  return {
    schemaVersion: 1,
    summary: "Create a self-contained workflow.",
    base: patchBase,
    operations,
  };
}

const firstNode: CanvasOperation = {
  type: "createNode",
  tempId: "tmp_frame",
  nodeType: "frame",
  position: { x: 100, y: 100 },
  size: { width: 640, height: 420 },
  content: { title: "Workflow" },
};

const secondNode: CanvasOperation = {
  type: "createNode",
  tempId: "tmp_step",
  nodeType: "rectangle",
  position: { x: 160, y: 180 },
  size: { width: 220, height: 120 },
  content: { title: "Start" },
  parentId: "tmp_frame",
};

describe("self-contained additive canvas patches", () => {
  it("accepts ordered native creations whose references stay inside the patch", () => {
    expect(isSelfContainedAdditivePatch(patch([
      firstNode,
      secondNode,
      {
        type: "writeText",
        tempId: "tmp_label",
        position: { x: 420, y: 190 },
        text: "Review",
        fontSize: 24,
        maxWidth: 240,
        parentId: "tmp_frame",
      },
      {
        type: "createDrawing",
        tempId: "tmp_marker",
        position: { x: 420, y: 280 },
        segments: [{
          type: "straight",
          points: [{ x: 0, y: 0 }, { x: 80, y: 40 }],
        }],
        parentId: "tmp_frame",
      },
      {
        type: "createConnector",
        tempId: "tmp_connector",
        sourceId: "tmp_step",
        targetId: "tmp_label",
        route: "straight",
      },
    ]))).toBe(true);
  });

  it("accepts a standalone created node with no references", () => {
    expect(isSelfContainedAdditivePatch(patch([firstNode]))).toBe(true);
  });

  it.each([
    [
      "an existing parent",
      [{ ...secondNode, parentId: "existing-frame" }],
    ],
    [
      "a forward parent reference",
      [secondNode, firstNode],
    ],
    [
      "an existing connector endpoint",
      [
        firstNode,
        {
          type: "createConnector",
          tempId: "tmp_connector",
          sourceId: "tmp_frame",
          targetId: "existing-node",
          route: "straight",
        },
      ],
    ],
    [
      "a forward connector endpoint",
      [
        firstNode,
        {
          type: "createConnector",
          tempId: "tmp_connector",
          sourceId: "tmp_frame",
          targetId: "tmp_step",
          route: "straight",
        },
        secondNode,
      ],
    ],
  ] as const)("rejects %s", (_label, operations) => {
    expect(isSelfContainedAdditivePatch(patch(
      operations as unknown as CanvasOperation[],
    ))).toBe(false);
  });

  it("rejects duplicate temporary identifiers across creation kinds", () => {
    expect(isSelfContainedAdditivePatch(patch([
      firstNode,
      {
        type: "writeText",
        tempId: "tmp_frame",
        position: { x: 120, y: 120 },
        text: "Duplicate",
        fontSize: 20,
        maxWidth: 200,
      },
    ]))).toBe(false);
  });

  it.each<CanvasOperation>([
    { type: "updateNode", nodeId: "existing-node", content: { title: "Changed" } },
    { type: "moveNode", nodeId: "existing-node", position: { x: 200, y: 200 } },
    { type: "resizeNode", nodeId: "existing-node", size: { width: 300, height: 200 } },
    { type: "deleteNode", nodeId: "existing-node" },
  ])("rejects the existing-object mutation $type", (operation) => {
    expect(isSelfContainedAdditivePatch(patch([operation]))).toBe(false);
  });

  it("rejects an empty patch even when supplied across a runtime boundary", () => {
    expect(isSelfContainedAdditivePatch({
      schemaVersion: 1,
      summary: "Empty",
      base: patchBase,
      operations: [],
    } as unknown as CanvasPatch)).toBe(false);
  });
});
