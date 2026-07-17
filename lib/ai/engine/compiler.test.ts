import { describe, expect, it } from "vitest";

import type { CanvasNode } from "../../types";
import type { CanvasOperation } from "../canvas-patch";
import { BoardProposalSchema } from "./board-plan";
import { buildAuthorizedBoardScene } from "./authorized-scene";
import { BoardPlanCompileError, compileBoardProposal } from "./compiler";

const base = {
  workspaceId: "workspace-1",
  boardId: "board-1",
  documentGenerationId: "generation-1",
  durableSequence: 12,
  selectionHash: "a".repeat(64),
} as const;

type CreateNodeOperation = Extract<CanvasOperation, { type: "createNode" }>;
type MoveNodeOperation = Extract<CanvasOperation, { type: "moveNode" }>;

function isCreateNode(operation: CanvasOperation): operation is CreateNodeOperation {
  return operation.type === "createNode";
}

function isMoveNode(operation: CanvasOperation): operation is MoveNodeOperation {
  return operation.type === "moveNode";
}

function node(id: string, x: number, y = 0, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: "note",
    title: id,
    x,
    y,
    width: 200,
    height: 120,
    fill: "#ffedb7",
    ...overrides,
  };
}

function scene(input: {
  nodes?: CanvasNode[];
  selectedIds?: string[];
  viewport?: { x: number; y: number; width: number; height: number };
} = {}) {
  const nodes = input.nodes ?? [];
  const byId = new Map(nodes.map((item) => [item.id, item]));
  return buildAuthorizedBoardScene({
    snapshot: { nodes, edges: [] },
    selection: (input.selectedIds ?? []).map((id) => {
      const item = byId.get(id)!;
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        ...(item.body !== undefined ? { body: item.body } : {}),
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        ...(item.locked !== undefined ? { locked: item.locked } : {}),
        ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
      };
    }),
    viewport: input.viewport ?? { x: 0, y: 0, width: 1_400, height: 900 },
  });
}

describe("deterministic board-plan compiler", () => {
  it("preserves Unicode mathematics in native editable text blocks", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Show the exact solution.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "composeText",
          key: "solution",
          presentation: "typed",
          blocks: [
            { role: "equation", text: "2x + 3 = 11 ⇒ 2x = 8" },
            { role: "answer", text: "x = 4; ∀ x ∈ ℝ" },
          ],
        },
      ],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    expect(patch.operations).toHaveLength(2);
    expect(patch.operations.every((operation) => operation.type === "createNode")).toBe(true);
    expect(JSON.stringify(patch.operations)).toContain("⇒");
    expect(JSON.stringify(patch.operations)).toContain("∀ x ∈ ℝ");
    expect(patch.operations.some((operation) => operation.type === "writeText")).toBe(false);
  });

  it("produces a byte-identical patch across repeated compilations", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a three-step flow.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "addDiagram",
          key: "flow",
          title: "Release flow",
          layout: "flow-horizontal",
          nodes: [
            { key: "draft", shape: "note", label: "Draft" },
            { key: "review", shape: "diamond", label: "Review" },
            { key: "ship", shape: "summary", label: "Ship" },
          ],
          connections: [
            { from: "draft", to: "review" },
            { from: "review", to: "ship", label: "approved" },
          ],
        },
      ],
    });
    const context = scene();
    const expected = JSON.stringify(compileBoardProposal({ proposal, scene: context, base }));

    for (let index = 0; index < 100; index += 1) {
      expect(JSON.stringify(compileBoardProposal({ proposal, scene: context, base }))).toBe(expected);
    }
  });

  it("uses disjoint semantic IDs for distinct proposals on the same board snapshot", () => {
    const proposalFor = (title: string) => BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: `Create ${title}.`,
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "addCards",
          cards: [{ key: "card", variant: "note", title }],
        },
      ],
    });
    const context = scene();
    const first = compileBoardProposal({ proposal: proposalFor("First"), scene: context, base });
    const second = compileBoardProposal({ proposal: proposalFor("Second"), scene: context, base });
    const firstIds = first.operations.flatMap((operation) =>
      "tempId" in operation ? [operation.tempId] : [],
    );
    const secondIds = second.operations.flatMap((operation) =>
      "tempId" in operation ? [operation.tempId] : [],
    );

    expect(firstIds).toHaveLength(1);
    expect(secondIds).toHaveLength(1);
    expect(firstIds[0]).toMatch(/^tmp_ai_[a-f0-9]{48}_001$/);
    expect(new Set([...firstIds, ...secondIds])).toHaveLength(2);
  });

  it("emits diagram parents and endpoints before dependent operations", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a flowchart.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "addDiagram",
          key: "flow",
          layout: "flow-vertical",
          nodes: [
            { key: "one", shape: "rectangle", label: "One" },
            { key: "two", shape: "rectangle", label: "Two" },
          ],
          connections: [{ from: "one", to: "two" }],
        },
      ],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    expect(patch.operations.map((operation) => operation.type)).toEqual([
      "createNode",
      "createNode",
      "createNode",
      "createConnector",
    ]);
    const frame = patch.operations[0];
    const firstChild = patch.operations[1];
    const connector = patch.operations[3];
    expect(frame).toMatchObject({ type: "createNode", nodeType: "frame" });
    expect(firstChild).toMatchObject({ type: "createNode", parentId: frame && "tempId" in frame ? frame.tempId : "" });
    expect(connector).toMatchObject({ type: "createConnector" });
  });

  it("avoids visible read-only obstacles when placing generated content", () => {
    const obstacle = node("obstacle", 400, 280, { width: 600, height: 340 });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Add one card.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "addCards",
          cards: [{ key: "card", variant: "note", title: "New card" }],
        },
      ],
    });

    const patch = compileBoardProposal({
      proposal,
      scene: scene({ nodes: [obstacle] }),
      base,
    });
    const created = patch.operations[0];
    expect(created?.type).toBe("createNode");
    if (created?.type !== "createNode") return;
    const overlap =
      created.position.x < obstacle.x + obstacle.width + 32 &&
      created.position.x + created.size.width + 32 > obstacle.x &&
      created.position.y < obstacle.y + obstacle.height + 32 &&
      created.position.y + created.size.height + 32 > obstacle.y;
    expect(overlap).toBe(false);
  });

  it("arranges only authorized selected nodes", () => {
    const selected = [node("one", 0), node("two", 260)];
    const context = scene({ nodes: [...selected, node("visible", 700)], selectedIds: ["one", "two"] });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange the selected cards.",
      placement: "selection-below",
      flow: "horizontal",
      actions: [
        {
          kind: "arrangeSelection",
          selectionRefs: ["s1", "s2"],
          arrangement: "column",
          spacing: "comfortable",
        },
      ],
    });

    const patch = compileBoardProposal({ proposal, scene: context, base });
    expect(patch.operations).toHaveLength(2);
    expect(patch.operations.map((operation) => "nodeId" in operation ? operation.nodeId : "")).toEqual([
      "one",
      "two",
    ]);
  });

  it.each([
    ["cycle", 3],
    ["cycle", 5],
    ["mind-map", 3],
    ["mind-map", 5],
  ] as const)("keeps a %s with %i nodes inside its frame without overlap", (layout, count) => {
    const nodes = Array.from({ length: count }, (_, index) => ({
      key: index === 0 ? "root" : `node_${index}`,
      shape: "rectangle" as const,
      label: index === 0 ? "Root" : `Node ${index}`,
    }));
    const connections = layout === "mind-map"
      ? nodes.slice(1).map((item) => ({ from: "root", to: item.key }))
      : nodes.map((item, index) => ({
          from: item.key,
          to: nodes[(index + 1) % nodes.length]!.key,
        }));
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: `Create a ${layout}.`,
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "diagram",
        layout,
        nodes,
        connections,
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const created = patch.operations.filter(isCreateNode);
    const frame = created.find((operation) => operation.nodeType === "frame")!;
    const children = created.filter((operation) => operation.nodeType !== "frame");

    expect(children).toHaveLength(count);
    children.forEach((child) => {
      expect(child.position.x).toBeGreaterThanOrEqual(frame.position.x);
      expect(child.position.y).toBeGreaterThanOrEqual(frame.position.y);
      expect(child.position.x + child.size.width).toBeLessThanOrEqual(
        frame.position.x + frame.size.width,
      );
      expect(child.position.y + child.size.height).toBeLessThanOrEqual(
        frame.position.y + frame.size.height,
      );
    });
    for (let left = 0; left < children.length; left += 1) {
      for (let right = left + 1; right < children.length; right += 1) {
        const a = children[left]!;
        const b = children[right]!;
        expect(
          a.position.x < b.position.x + b.size.width + 12 &&
          a.position.x + a.size.width + 12 > b.position.x &&
          a.position.y < b.position.y + b.size.height + 12 &&
          a.position.y + a.size.height + 12 > b.position.y,
        ).toBe(false);
      }
    }

    if (layout === "mind-map") {
      const root = children.find((operation) => operation.content.title === "Root")!;
      const leaves = children.filter((operation) => operation !== root);
      const rootCenter = {
        x: root.position.x + root.size.width / 2,
        y: root.position.y + root.size.height / 2,
      };
      const leafCenters = leaves.map((leaf) => ({
        x: leaf.position.x + leaf.size.width / 2,
        y: leaf.position.y + leaf.size.height / 2,
      }));
      expect(rootCenter.x).toBeGreaterThanOrEqual(Math.min(...leafCenters.map((item) => item.x)));
      expect(rootCenter.x).toBeLessThanOrEqual(Math.max(...leafCenters.map((item) => item.x)));
      expect(rootCenter.y).toBeGreaterThanOrEqual(Math.min(...leafCenters.map((item) => item.y)));
      expect(rootCenter.y).toBeLessThanOrEqual(Math.max(...leafCenters.map((item) => item.y)));
    }
  });

  it("ranks hierarchy nodes from their directed topology", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a ranked hierarchy.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "org",
        layout: "hierarchy",
        nodes: [
          { key: "root", shape: "rectangle", label: "Root" },
          { key: "left", shape: "rectangle", label: "Left" },
          { key: "right", shape: "rectangle", label: "Right" },
          { key: "leaf", shape: "rectangle", label: "Leaf" },
        ],
        connections: [
          { from: "root", to: "left" },
          { from: "root", to: "right" },
          { from: "left", to: "leaf" },
        ],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const children = patch.operations.filter(
      (operation): operation is CreateNodeOperation =>
        operation.type === "createNode" && operation.nodeType !== "frame",
    );
    const byTitle = new Map(children.map((operation) => [operation.content.title, operation]));
    expect(byTitle.get("Root")!.position.y).toBeLessThan(byTitle.get("Left")!.position.y);
    expect(byTitle.get("Left")!.position.y).toBe(byTitle.get("Right")!.position.y);
    expect(byTitle.get("Left")!.position.y).toBeLessThan(byTitle.get("Leaf")!.position.y);
  });

  it("normalizes circle arrangements before avoiding obstacles", () => {
    const selected = Array.from({ length: 5 }, (_, index) => node(`selected-${index}`, index * 220));
    const obstacle = node("obstacle", 0, 0, { width: 1_100, height: 360 });
    const context = scene({
      nodes: [...selected, obstacle],
      selectedIds: selected.map((item) => item.id),
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange the selected notes in a circle.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "arrangeSelection",
        selectionRefs: ["s1", "s2", "s3", "s4", "s5"],
        arrangement: "circle",
        spacing: "comfortable",
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: context, base });
    const moves = patch.operations.filter(isMoveNode);
    expect(moves).toHaveLength(5);
    const movedBounds = moves.map((move) => ({
      ...move.position,
      width: selected.find((item) => item.id === move.nodeId)!.width,
      height: selected.find((item) => item.id === move.nodeId)!.height,
    }));
    for (let left = 0; left < movedBounds.length; left += 1) {
      const a = movedBounds[left]!;
      expect(
        a.x < obstacle.x + obstacle.width + 12 &&
        a.x + a.width + 12 > obstacle.x &&
        a.y < obstacle.y + obstacle.height + 12 &&
        a.y + a.height + 12 > obstacle.y,
      ).toBe(false);
      for (let right = left + 1; right < movedBounds.length; right += 1) {
        const b = movedBounds[right]!;
        expect(
          a.x < b.x + b.width + 12 && a.x + a.width + 12 > b.x &&
          a.y < b.y + b.height + 12 && a.y + a.height + 12 > b.y,
        ).toBe(false);
      }
    }
  });

  it("keeps disjoint arrangements and generated groups collision-free", () => {
    const selected = Array.from({ length: 4 }, (_, index) => node(`selected-${index}`, index * 230));
    const context = scene({ nodes: selected, selectedIds: selected.map((item) => item.id) });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange two groups and add a summary.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "arrangeSelection",
          selectionRefs: ["s1", "s2"],
          arrangement: "row",
          spacing: "comfortable",
        },
        {
          kind: "arrangeSelection",
          selectionRefs: ["s3", "s4"],
          arrangement: "row",
          spacing: "comfortable",
        },
        {
          kind: "addCards",
          cards: [{ key: "summary", variant: "summary", title: "Summary" }],
        },
      ],
    });

    expect(() => compileBoardProposal({ proposal, scene: context, base })).not.toThrow();
  });

  it("expands generated nodes deterministically for long allowed content", () => {
    const body = "word ".repeat(144).trim();
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create readable detailed content.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "addCards",
          cards: [{ key: "card", variant: "note", title: "Detailed card", body }],
        },
        {
          kind: "addShapes",
          shapes: [{ key: "shape", shape: "rectangle", label: "Detailed shape", detail: body }],
        },
        {
          kind: "addDiagram",
          key: "details",
          layout: "flow-horizontal",
          nodes: [
            { key: "one", shape: "rectangle", label: "One", detail: body },
            { key: "two", shape: "rectangle", label: "Two" },
          ],
          connections: [{ from: "one", to: "two" }],
        },
      ],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const detailed = patch.operations.filter(
      (operation): operation is CreateNodeOperation =>
        operation.type === "createNode" && operation.content.body === body,
    );
    expect(detailed).toHaveLength(3);
    detailed.forEach((operation) => {
      expect(operation.size.width).toBeGreaterThanOrEqual(400);
      expect(operation.size.height).toBeGreaterThanOrEqual(500);
      expect(operation.size.height).toBeLessThanOrEqual(760);
    });
  });

  it("compiles the worst-case schema-valid vertical diagram within canvas bounds", () => {
    const body = "word ".repeat(144).trim();
    const nodes = Array.from({ length: 11 }, (_, index) => ({
      key: `step_${index}`,
      shape: "rectangle" as const,
      label: `Step ${index + 1}`,
      detail: body,
    }));
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create the largest supported readable vertical diagram.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "bounded_flow",
        layout: "flow-vertical",
        nodes,
        connections: nodes.slice(1).map((_node, index) => ({
          from: `step_${index}`,
          to: `step_${index + 1}`,
        })),
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const frame = patch.operations.find(
      (operation): operation is CreateNodeOperation =>
        operation.type === "createNode" && operation.nodeType === "frame",
    );
    expect(frame).toBeDefined();
    expect(frame!.size.width).toBeLessThanOrEqual(10_000);
    expect(frame!.size.height).toBeLessThanOrEqual(10_000);
  });

  it("rejects visible or locked objects as mutation targets", () => {
    const context = scene({
      nodes: [node("selected", 0, 0, { locked: true }), node("visible", 300)],
      selectedIds: ["selected"],
    });
    const visibleProposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Style context.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        { kind: "styleSelection", selectionRefs: ["v1"], style: { tone: "blue" } },
      ],
    });
    const lockedProposal = BoardProposalSchema.parse({
      ...visibleProposal,
      actions: [
        { kind: "styleSelection", selectionRefs: ["s1"], style: { tone: "blue" } },
      ],
    });

    expect(() => compileBoardProposal({ proposal: visibleProposal, scene: context, base })).toThrow(
      BoardPlanCompileError,
    );
    expect(() => compileBoardProposal({ proposal: lockedProposal, scene: context, base })).toThrow(
      BoardPlanCompileError,
    );
  });

  it("rejects arranging a selected ancestor and descendant in one operation", () => {
    const context = scene({
      nodes: [
        node("frame", 0, 0, { type: "frame", width: 600, height: 420 }),
        node("child", 60, 80, { parentId: "frame" }),
      ],
      selectedIds: ["frame", "child"],
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange the nested selection.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "arrangeSelection",
        selectionRefs: ["s1", "s2"],
        arrangement: "row",
        spacing: "comfortable",
      }],
    });

    expect(() => compileBoardProposal({ proposal, scene: context, base })).toThrow(
      /Nested parent and child objects/,
    );
  });
});
