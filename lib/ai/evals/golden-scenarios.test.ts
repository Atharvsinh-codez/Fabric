import { describe, expect, it } from "vitest";

import type { CanvasNode } from "../../types";
import { buildBoardAssistanceInput } from "../skills/board-assistance.v1";
import { BoardProposalSchema } from "../engine/board-plan";
import { buildAuthorizedBoardScene } from "../engine/authorized-scene";
import { compileBoardProposal } from "../engine/compiler";

const base = {
  workspaceId: "eval-workspace",
  boardId: "eval-board",
  documentGenerationId: "eval-generation",
  durableSequence: 1,
} as const;

function note(id: string, x: number, y: number): CanvasNode {
  return {
    id,
    type: "note",
    title: `Note ${id}`,
    x,
    y,
    width: 180,
    height: 120,
    fill: "yellow",
  };
}

describe("Fabric agent golden quality scenarios", () => {
  it("keeps a handwritten algebra source untouched and writes a readable exact answer", () => {
    const drawing = {
      id: "source-drawing",
      type: "drawing" as const,
      title: "Handwritten equation",
      x: 0,
      y: 0,
      width: 360,
      height: 140,
      fill: "ink",
    };
    const selection = [{
      ...drawing,
      source: {
        shapeType: "draw" as const,
        segments: [{
          type: "free" as const,
          points: [{ x: 0, y: 0 }, { x: 100, y: 60 }],
        }],
      },
    }];
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [drawing], edges: [] },
      selection,
      viewport: { x: -100, y: -100, width: 1_200, height: 800 },
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Solve the handwritten equation.",
      placement: "selection-right",
      flow: "vertical",
      actions: [{
        kind: "composeText",
        key: "solution",
        presentation: "typed",
        blocks: [
          { role: "equation", text: "2x + 3 = 11 ⇒ 2x = 8" },
          { role: "answer", text: "x = 4" },
        ],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene, base });
    expect(patch.operations.every((operation) => operation.type === "createNode")).toBe(true);
    expect(patch.operations.some((operation) =>
      "nodeId" in operation && operation.nodeId === drawing.id,
    )).toBe(false);
    expect(JSON.stringify(patch)).toContain("⇒");
    expect(JSON.stringify(patch)).toContain("x = 4");
    expect(JSON.stringify(patch)).not.toContain('"type":"writeText"');
  });

  it("creates a six-step editable flow with ordered endpoints and no node overlap", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 2_000, height: 1_200 },
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create the release flow.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "release",
        title: "Release workflow",
        layout: "flow-horizontal",
        nodes: Array.from({ length: 6 }, (_, index) => ({
          key: `step_${index + 1}`,
          shape: index === 3 ? "diamond" : "rectangle",
          label: `Step ${index + 1}`,
        })),
        connections: Array.from({ length: 5 }, (_, index) => ({
          from: `step_${index + 1}`,
          to: `step_${index + 2}`,
        })),
      }],
    });

    const patch = compileBoardProposal({ proposal, scene, base });
    const nodeOperations = patch.operations.filter(
      (operation) => operation.type === "createNode" && operation.nodeType !== "frame",
    );
    const connectorStart = patch.operations.findIndex(
      (operation) => operation.type === "createConnector",
    );
    expect(nodeOperations).toHaveLength(6);
    expect(patch.operations.slice(connectorStart).every(
      (operation) => operation.type === "createConnector",
    )).toBe(true);
    for (let left = 0; left < nodeOperations.length; left += 1) {
      for (let right = left + 1; right < nodeOperations.length; right += 1) {
        const a = nodeOperations[left]!;
        const b = nodeOperations[right]!;
        if (a.type !== "createNode" || b.type !== "createNode") continue;
        const overlaps =
          a.position.x < b.position.x + b.size.width &&
          a.position.x + a.size.width > b.position.x &&
          a.position.y < b.position.y + b.size.height &&
          a.position.y + a.size.height > b.position.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("organizes all and only twelve selected notes", () => {
    const nodes = Array.from({ length: 13 }, (_, index) =>
      note(`node-${String(index + 1).padStart(2, "0")}`, (index % 4) * 220, Math.floor(index / 4) * 160),
    );
    const selected = nodes.slice(0, 12);
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes, edges: [] },
      selection: selected,
      viewport: { x: -100, y: -100, width: 1_500, height: 1_000 },
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange the selected notes.",
      placement: "selection-below",
      flow: "grid",
      actions: [{
        kind: "arrangeSelection",
        selectionRefs: scene.writableHandles,
        arrangement: "grid",
        spacing: "comfortable",
      }],
    });

    const patch = compileBoardProposal({ proposal, scene, base });
    expect(patch.operations).toHaveLength(12);
    expect(new Set(patch.operations.map((operation) =>
      "nodeId" in operation ? operation.nodeId : "",
    ))).toEqual(new Set(selected.map((node) => node.id)));
    expect(JSON.stringify(patch)).not.toContain(nodes[12]!.id);
  });

  it("grounds a no-selection request in real visible nodes and edges without exposing durable IDs", () => {
    const nodes = [
      { ...note("durable-secret-a", 0, 0), title: "Alpha" },
      { ...note("durable-secret-b", 260, 0), title: "Beta" },
    ];
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes,
        edges: [{
          id: "secret-edge",
          sourceId: nodes[0]!.id,
          targetId: nodes[1]!.id,
          route: "straight",
        }],
      },
      selection: [],
      viewport: { x: -100, y: -100, width: 1_000, height: 700 },
    });
    const input = buildBoardAssistanceInput({
      skill: "canvas-agent",
      ...base,
      instruction: "Summarize the visible flow.",
      selection: [],
      viewport: scene.viewport,
      conversation: [],
      scene,
    });

    expect(input).toContain('"handle":"v1"');
    expect(input).toContain('"sourceHandle":"v');
    expect(input).not.toContain("durable-secret-a");
    expect(input).not.toContain("secret-edge");
  });
});
