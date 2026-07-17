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

  it("arranges authorized visible-canvas nodes without a browser selection", () => {
    const context = scene({
      nodes: [node("one", 80, 80), node("two", 360, 80)],
      viewport: { x: 0, y: 0, width: 800, height: 600 },
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange the visible cards.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "arrangeSelection",
        selectionRefs: ["v1", "v2"],
        arrangement: "column",
        spacing: "comfortable",
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: context, base });
    const moves = patch.operations.filter(isMoveNode);
    expect(moves.map((operation) => operation.nodeId).sort()).toEqual(["one", "two"]);
    for (const operation of moves) {
      const original = context.nodes.find((item) => item.id === operation.nodeId)!;
      expect(operation.position.x).toBeGreaterThanOrEqual(context.viewport.x);
      expect(operation.position.y).toBeGreaterThanOrEqual(context.viewport.y);
      expect(operation.position.x + original.bounds.width).toBeLessThanOrEqual(
        context.viewport.x + context.viewport.width,
      );
      expect(operation.position.y + original.bounds.height).toBeLessThanOrEqual(
        context.viewport.y + context.viewport.height,
      );
    }
  });

  it("arranges siblings inside their common parent and authorized viewport", () => {
    const frame = node("frame", 0, 0, { type: "frame", width: 800, height: 600 });
    const first = node("first", 80, 100, { parentId: frame.id });
    const second = node("second", 360, 100, { parentId: frame.id });
    const context = scene({
      nodes: [frame, first, second],
      selectedIds: [first.id, second.id],
      viewport: { x: 0, y: 0, width: 700, height: 520 },
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange the cards inside their frame.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "arrangeSelection",
        selectionRefs: ["s1", "s2"],
        arrangement: "column",
        spacing: "comfortable",
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: context, base });
    const moves = patch.operations.filter(isMoveNode);
    expect(moves).toHaveLength(2);
    for (const move of moves) {
      const original = context.nodes.find((item) => item.id === move.nodeId)!;
      expect(move.position.x).toBeGreaterThanOrEqual(24);
      expect(move.position.y).toBeGreaterThanOrEqual(24);
      expect(move.position.x + original.bounds.width).toBeLessThanOrEqual(700);
      expect(move.position.y + original.bounds.height).toBeLessThanOrEqual(520);
    }
  });

  it("rejects mixed-parent arrangements and parent interiors too small for the layout", () => {
    const leftFrame = node("left-frame", 0, 0, { type: "frame", width: 420, height: 500 });
    const rightFrame = node("right-frame", 500, 0, { type: "frame", width: 420, height: 500 });
    const left = node("left", 40, 80, { parentId: leftFrame.id });
    const right = node("right", 540, 80, { parentId: rightFrame.id });
    const mixedContext = scene({
      nodes: [leftFrame, rightFrame, left, right],
      selectedIds: [left.id, right.id],
      viewport: { x: 0, y: 0, width: 1_000, height: 600 },
    });
    const mixedProposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Arrange cards from separate frames.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "arrangeSelection",
        selectionRefs: ["s1", "s2"],
        arrangement: "row",
        spacing: "compact",
      }],
    });
    expect(() => compileBoardProposal({ proposal: mixedProposal, scene: mixedContext, base }))
      .toThrow(/different containers/);

    const narrowFrame = node("narrow-frame", 0, 0, {
      type: "frame",
      width: 420,
      height: 500,
    });
    const first = node("first", 20, 80, { parentId: narrowFrame.id });
    const second = node("second", 220, 80, { parentId: narrowFrame.id });
    const narrowContext = scene({
      nodes: [narrowFrame, first, second],
      selectedIds: [first.id, second.id],
      viewport: { x: 0, y: 0, width: 300, height: 500 },
    });
    expect(() => compileBoardProposal({ proposal: mixedProposal, scene: narrowContext, base }))
      .toThrow(/does not fit inside its authorized container/);
  });

  it("edits and styles only server-authorized visible-canvas handles", () => {
    const context = scene({
      nodes: [node("inside", 100), node("partial", -100), node("locked", 400, 0, { locked: true })],
      viewport: { x: 0, y: 0, width: 700, height: 500 },
    });
    const inside = context.nodes.find((item) => item.id === "inside")!;
    const partial = context.nodes.find((item) => item.id === "partial")!;
    const locked = context.nodes.find((item) => item.id === "locked")!;
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Polish the visible card.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "editSelection",
          edits: [{ selectionRef: inside.handle, title: "Updated" }],
        },
        {
          kind: "styleSelection",
          selectionRefs: [inside.handle],
          style: { tone: "blue" },
        },
      ],
    });

    const patch = compileBoardProposal({ proposal, scene: context, base });
    expect(patch.operations).toEqual([
      expect.objectContaining({
        type: "updateNode",
        nodeId: "inside",
        content: { title: "Updated" },
        appearance: { fill: "sky" },
      }),
    ]);

    for (const handle of [partial.handle, locked.handle]) {
      const unsafe = BoardProposalSchema.parse({
        ...proposal,
        actions: [{ kind: "styleSelection", selectionRefs: [handle], style: { tone: "blue" } }],
      });
      expect(() => compileBoardProposal({ proposal: unsafe, scene: context, base })).toThrow(
        BoardPlanCompileError,
      );
    }
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

  it("rejects moving a selected container with its descendant", () => {
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
      /does not allow move changes/,
    );
  });

  it("turns a heading, overview, and facts into a compact deterministic hierarchy", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Explain the system clearly.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "composeText",
        key: "explanation",
        presentation: "typed",
        blocks: [
          { role: "heading", text: "How the system works" },
          { role: "body", text: "A short overview that establishes the main idea." },
          { role: "label", text: "1. Receive the request" },
          { role: "label", text: "2. Validate the input" },
          { role: "label", text: "3. Process the result" },
          { role: "label", text: "4. Return the response" },
        ],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const created = patch.operations.filter(isCreateNode);
    expect(created).toHaveLength(6);
    expect(created[0]).toMatchObject({
      size: { width: 712 },
      appearance: { fill: "sky", textColor: "surface" },
    });
    expect(created[1]).toMatchObject({
      size: { width: 712 },
      appearance: { fill: "fog", textColor: "ink" },
    });
    expect(created[2]!.position.y).toBe(created[3]!.position.y);
    expect(created[2]!.position.x).toBeLessThan(created[3]!.position.x);
    expect(created[4]!.position.y).toBe(created[5]!.position.y);
    expect(created[4]!.position.y).toBeGreaterThan(created[2]!.position.y);
    expect(new Set(created.slice(2).map((operation) => operation.appearance?.fill)).size)
      .toBeGreaterThan(1);
  });

  it("wraps dense horizontal flows and preserves unsafe labels in collision-free notes", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a bounded five-step flow.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "flow",
        title: "Request lifecycle",
        layout: "flow-horizontal",
        nodes: [
          { key: "one", shape: "rectangle", label: "Receive" },
          { key: "two", shape: "rectangle", label: "Parse" },
          { key: "three", shape: "diamond", label: "Validate" },
          { key: "four", shape: "hexagon", label: "Store" },
          { key: "five", shape: "rectangle", label: "Return" },
        ],
        connections: [
          { from: "one", to: "two", label: "request" },
          { from: "two", to: "three", label: "parsed" },
          { from: "three", to: "four", label: "approved" },
          { from: "four", to: "five", label: "result" },
        ],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const created = patch.operations.filter(isCreateNode);
    const frame = created.find((operation) => operation.nodeType === "frame")!;
    const graphNodes = created.slice(1, 6);
    const connectionNotes = created.slice(6);
    const connectors = patch.operations.filter(
      (operation) => operation.type === "createConnector",
    );
    expect(new Set(graphNodes.map((operation) => operation.position.y)).size).toBe(2);
    expect(frame.size.width).toBeLessThan(1_600);
    expect(connectors).toHaveLength(4);
    expect(connectors.every((operation) => operation.route === "elbow")).toBe(true);
    expect(connectors.every((operation) => operation.label === undefined)).toBe(true);
    expect(graphNodes[0]!.appearance?.fill).toBe("sky");
    expect(graphNodes.at(-1)!.appearance?.fill).toBe("mint");
    expect(graphNodes[2]!.appearance?.fill).toBe("butter");
    expect(connectionNotes).toHaveLength(1);
    expect(connectionNotes[0]).toMatchObject({
      nodeType: "summary",
      content: {
        title: "Connection notes",
        body: expect.stringContaining("1. Receive \u2192 Parse\nrequest"),
      },
      parentId: frame.tempId,
    });
    for (const label of ["request", "parsed", "approved", "result"]) {
      expect(connectionNotes[0]!.content.body).toContain(label);
    }
    const graphBottom = Math.max(
      ...graphNodes.map((operation) => operation.position.y + operation.size.height),
    );
    expect(connectionNotes[0]!.position.y).toBeGreaterThan(graphBottom);
    expect(connectionNotes[0]!.position.x).toBeGreaterThanOrEqual(frame.position.x);
    expect(connectionNotes[0]!.position.x + connectionNotes[0]!.size.width)
      .toBeLessThanOrEqual(frame.position.x + frame.size.width);
    expect(connectionNotes[0]!.position.y + connectionNotes[0]!.size.height)
      .toBeLessThanOrEqual(frame.position.y + frame.size.height);
  });

  it("retains short labels only when a flow has a clear connector corridor", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a concise flow.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "flow",
        title: "Concise flow",
        layout: "flow-horizontal",
        nodes: [
          { key: "one", shape: "rectangle", label: "One" },
          { key: "two", shape: "rectangle", label: "Two" },
          { key: "three", shape: "rectangle", label: "Three" },
        ],
        connections: [
          { from: "one", to: "two", label: "next" },
          { from: "two", to: "three", label: "this label is deliberately much too long" },
        ],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const children = patch.operations.filter(
      (operation): operation is CreateNodeOperation =>
        operation.type === "createNode" && operation.nodeType !== "frame",
    );
    const connectors = patch.operations.filter(
      (operation) => operation.type === "createConnector",
    );
    expect(children[1]!.position.x - (children[0]!.position.x + children[0]!.size.width))
      .toBeGreaterThanOrEqual(128);
    expect(connectors.map((operation) => operation.label)).toEqual(["next", undefined]);
    expect(connectors.every((operation) => operation.route === "straight")).toBe(true);
    const connectionNotes = children.filter(
      (operation) => operation.content.title === "Connection notes",
    );
    expect(connectionNotes).toHaveLength(1);
    expect(connectionNotes[0]!.content.body).toBe(
      "2. Two \u2192 Three\nthis label is deliberately much too long",
    );
    expect(connectionNotes[0]!.content.body).not.toContain("next");
  });

  it("moves short hierarchy labels into connection notes instead of unsafe corridors", () => {
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Create a labeled hierarchy.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "hierarchy",
        layout: "hierarchy",
        nodes: [
          { key: "root", shape: "rectangle", label: "Root" },
          { key: "leaf", shape: "rectangle", label: "Leaf" },
        ],
        connections: [{ from: "root", to: "leaf", label: "yes" }],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const connector = patch.operations.find((operation) => operation.type === "createConnector");
    const note = patch.operations.find(
      (operation): operation is CreateNodeOperation =>
        operation.type === "createNode" && operation.content.title === "Connection notes",
    );
    expect(connector).toBeDefined();
    expect(connector && "label" in connector).toBe(false);
    expect(note?.content.body).toBe("1. Root \u2192 Leaf\nyes");
  });

  it.each(["flow-vertical", "flow-horizontal"] as const)(
    "moves branched %s labels into connection notes",
    (layout) => {
      const proposal = BoardProposalSchema.parse({
        schemaVersion: 1,
        kind: "proposal",
        summary: "Create a labeled branch.",
        placement: "viewport-center",
        flow: "vertical",
        actions: [{
          kind: "addDiagram",
          key: `branch-${layout}`,
          layout,
          nodes: [
            { key: "start", shape: "rectangle", label: "Start" },
            { key: "left", shape: "rectangle", label: "Left" },
            { key: "right", shape: "rectangle", label: "Right" },
            { key: "finish", shape: "rectangle", label: "Finish" },
          ],
          connections: [
            { from: "start", to: "left", label: "one" },
            { from: "start", to: "right", label: "two" },
            { from: "right", to: "finish", label: "three" },
          ],
        }],
      });

      const patch = compileBoardProposal({ proposal, scene: scene(), base });
      const connectors = patch.operations.filter(
        (operation) => operation.type === "createConnector",
      );
      const note = patch.operations.find(
        (operation): operation is CreateNodeOperation =>
          operation.type === "createNode" &&
          operation.content.title === "Connection notes",
      );
      expect(connectors.every((connector) => !("label" in connector))).toBe(true);
      expect(note?.content.body).toContain("Start \u2192 Left\none");
      expect(note?.content.body).toContain("Start \u2192 Right\ntwo");
      expect(note?.content.body).toContain("Right \u2192 Finish\nthree");
    },
  );

  it("losslessly escapes newline-heavy labels into notes below the canvas dimension limit", () => {
    const source = `${"S\n".repeat(79)}S`;
    const target = `${"T\n".repeat(79)}T`;
    const label = `${"L\n".repeat(59)}L`;
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Preserve a multiline connection.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "addDiagram",
        key: "multiline",
        layout: "hierarchy",
        nodes: [
          { key: "source", shape: "rectangle", label: source },
          { key: "target", shape: "rectangle", label: target },
        ],
        connections: [{ from: "source", to: "target", label }],
      }],
    });

    const patch = compileBoardProposal({ proposal, scene: scene(), base });
    const note = patch.operations.find(
      (operation): operation is CreateNodeOperation =>
        operation.type === "createNode" && operation.content.title === "Connection notes",
    )!;
    const escape = (value: string) => value
      .replaceAll("\\", "\\\\")
      .replaceAll("\r", "\\r")
      .replaceAll("\n", "\\n")
      .replaceAll("\t", "\\t");
    expect(note.content.body).toBe(`1. ${escape(source)} \u2192 ${escape(target)}\n${escape(label)}`);
    expect(note.content.body!.split("\n")).toHaveLength(2);
    expect(note.size.width).toBeLessThanOrEqual(10_000);
    expect(note.size.height).toBeLessThanOrEqual(10_000);
    expect(patch.operations.every((operation) =>
      operation.type !== "createNode" ||
      (operation.size.width <= 10_000 && operation.size.height <= 10_000)
    )).toBe(true);
  });

  it("compiles an estimator-approved plan to exactly 100 operations including notes", () => {
    const selected = Array.from({ length: 40 }, (_, index) =>
      node(`selected-${index + 1}`, (index % 8) * 240, Math.floor(index / 8) * 160));
    const context = scene({
      nodes: selected,
      selectedIds: selected.map((item) => item.id),
      viewport: { x: 0, y: 0, width: 10_000, height: 10_000 },
    });
    const references = Array.from({ length: 40 }, (_, index) => `s${index + 1}`);
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Use the complete safe operation budget.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        ...Array.from({ length: 4 }, (_, index) => ({
          kind: "addDiagram" as const,
          key: `flow_${index}`,
          layout: "hierarchy" as const,
          nodes: [
            { key: "source", shape: "rectangle" as const, label: `Source ${index}` },
            { key: "target", shape: "rectangle" as const, label: `Target ${index}` },
          ],
          connections: [{
            from: "source",
            to: "target",
            label: "requires a reviewed handoff",
          }],
        })),
        {
          kind: "arrangeSelection",
          selectionRefs: references,
          arrangement: "grid",
          spacing: "compact",
        },
        {
          kind: "styleSelection",
          selectionRefs: references,
          style: { tone: "blue" },
        },
      ],
    });

    const patch = compileBoardProposal({ proposal, scene: context, base });
    expect(patch.operations).toHaveLength(100);
    expect(patch.operations.filter(
      (operation) => operation.type === "createNode" &&
        operation.content.title === "Connection notes",
    )).toHaveLength(4);
  });
});
