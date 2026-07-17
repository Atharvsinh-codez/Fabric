// @vitest-environment happy-dom

import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { describe, expect, it } from "vitest";
import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { drawShapeProps } from "@tldraw/tlschema";

import {
  applyTldrawProposal,
  serializeTldrawAiSelection,
} from "./tldraw-ai-adapter";
import type { CanvasNode, NodeType } from "../types";
import { BoardProposalSchema } from "../ai/engine/board-plan";
import { buildAuthorizedBoardScene } from "../ai/engine/authorized-scene";
import { compileBoardProposal } from "../ai/engine/compiler";
import { verifyApprovedPatchProjection } from "../ai/approval";
import {
  canvasNodeIdForTldrawShapeRecord,
  createFabricTldrawDocument,
  projectTldrawDocument,
} from "./tldraw-document";
import type { CanvasPatch } from "../ai/canvas-patch";

function shape(
  id: string,
  type: string,
  nodeId = `node-${id}`,
  props: Record<string, unknown> = {},
): TLShape {
  return {
    id: `shape:${id}`,
    type,
    props,
    meta: { fabric: { nodeId } },
  } as unknown as TLShape;
}

function node(id: string, type: NodeType = "note"): CanvasNode {
  return {
    id,
    type,
    title: id,
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    fill: "#ffffff",
  };
}

function selectionEditor(input: {
  selected: TLShape[];
  shapes: TLShape[];
  children?: Readonly<Record<string, TLShapeId[]>>;
}): Editor {
  const shapesById = new Map(input.shapes.map((entry) => [entry.id, entry]));
  return {
    getSelectedShapes: () => input.selected,
    getCurrentPageShapes: () => input.shapes,
    getShape: (id: TLShapeId) => shapesById.get(id),
    getSortedChildIdsForParent: (parent: TLShapeId) => input.children?.[parent] ?? [],
  } as unknown as Editor;
}

describe("tldraw AI selection serialization", () => {
  it("expands nested groups into deduplicated supported leaf objects", () => {
    const outer = shape("outer", "group");
    const inner = shape("inner", "group");
    const first = shape("first", "note");
    const second = shape("second", "geo");
    const connector = shape("connector", "arrow");
    const editor = selectionEditor({
      selected: [outer, second],
      shapes: [outer, inner, first, second, connector],
      children: {
        [outer.id]: [first.id, inner.id, connector.id],
        [inner.id]: [second.id],
      },
    });

    expect(
      serializeTldrawAiSelection(editor, [
        node("node-first"),
        node("node-second", "rectangle"),
      ]).map((entry) => entry.id),
    ).toEqual(["node-first", "node-second"]);
  });

  it("applies the 40-object cap after unsupported group children are filtered", () => {
    const group = shape("group", "group");
    const connector = shape("connector", "arrow");
    const supportedShapes = Array.from({ length: 42 }, (_, index) =>
      shape(`supported-${index}`, "note"),
    );
    const supportedNodes = supportedShapes.map((_entry, index) =>
      node(`node-supported-${index}`),
    );
    const editor = selectionEditor({
      selected: [group],
      shapes: [group, connector, ...supportedShapes],
      children: {
        [group.id]: [connector.id, ...supportedShapes.map((entry) => entry.id)],
      },
    });

    const selection = serializeTldrawAiSelection(editor, supportedNodes);

    expect(selection).toHaveLength(40);
    expect(selection[0]?.id).toBe("node-supported-0");
    expect(selection[39]?.id).toBe("node-supported-39");
  });

  it("leaves a single supported object for the panel's two-object validation", () => {
    const group = shape("group", "group");
    const onlyChild = shape("only-child", "text");
    const editor = selectionEditor({
      selected: [group],
      shapes: [group, onlyChild],
      children: { [group.id]: [onlyChild.id] },
    });

    expect(
      serializeTldrawAiSelection(editor, [node("node-only-child", "text")]),
    ).toHaveLength(1);
  });

  it("selects and applies to the repaired id of a historical duplicate AI shape", async () => {
    const duplicateId = "tmp_ai_historical_001";
    const first = shape("historical-first", "geo", duplicateId);
    const second = shape("historical-second", "geo", duplicateId);
    const secondFallbackId = canvasNodeIdForTldrawShapeRecord({
      ...(second as unknown as Record<string, unknown>),
      meta: {},
    });
    const editor = selectionEditor({
      selected: [first, second],
      shapes: [first, second],
    });

    expect(serializeTldrawAiSelection(editor, [
      node(duplicateId, "rectangle"),
      node(secondFallbackId, "rectangle"),
    ]).map((entry) => entry.id)).toEqual([duplicateId, secondFallbackId]);

    const updates: Array<Record<string, unknown>> = [];
    const applyEditor = {
      getInstanceState: () => ({ isReadonly: false }),
      markHistoryStoppingPoint: () => "mark:historical",
      run: (callback: () => void) => callback(),
      getCurrentPageShapes: () => [first, second],
      getShape: (id: TLShapeId) => id === first.id ? first : id === second.id ? second : undefined,
      updateShape: (input: Record<string, unknown>) => updates.push(input),
      bailToMark: () => undefined,
    } as unknown as Editor;
    await applyTldrawProposal({
      patch: {
        schemaVersion: 1,
        summary: "Update the repaired historical shape.",
        base: {
          workspaceId: "workspace-1",
          boardId: "board-1",
          documentGenerationId: "generation-1",
          durableSequence: 1,
        },
        operations: [{
          type: "updateNode",
          nodeId: secondFallbackId,
          content: { title: "Second shape" },
        }],
      },
      patchHash: "c".repeat(64),
      patchBytes: 256,
      affectedNodeIds: [secondFallbackId],
      riskClass: "low",
    }, applyEditor);
    expect(updates[0]?.id).toBe(second.id);
  });

  it("serializes bounded source geometry for a selected pen stroke", () => {
    const drawing = shape("pen", "draw", "node-pen", {
      segments: [
        {
          type: "free",
          points: [
            { x: -10, y: 5, z: 0.2 },
            { x: 30, y: 25, z: 0.8 },
          ],
        },
      ],
    });
    const editor = selectionEditor({ selected: [drawing], shapes: [drawing] });

    expect(
      serializeTldrawAiSelection(editor, [node("node-pen", "drawing")])[0]?.source,
    ).toEqual({
      shapeType: "draw",
      segments: [
        {
          type: "free",
          points: [
            { x: 0, y: 0, z: 0.2 },
            { x: 40, y: 20, z: 0.8 },
          ],
        },
      ],
    });
  });

  it("applies writeText as exactly one valid native multi-segment draw shape", async () => {
    const created: Array<Record<string, unknown>> = [];
    const editor = {
      getInstanceState: () => ({ isReadonly: false }),
      markHistoryStoppingPoint: () => "mark:test",
      run: (callback: () => void) => callback(),
      createShape: (input: Record<string, unknown>) => {
        created.push(input);
      },
      reparentShapes: () => undefined,
      bailToMark: () => undefined,
    } as unknown as Editor;

    await applyTldrawProposal(
      {
        patch: {
          schemaVersion: 1,
          summary: "Write the result with the pen.",
          base: {
            workspaceId: "workspace-1",
            boardId: "board-1",
            documentGenerationId: "generation-1",
            durableSequence: 1,
          },
          operations: [
            {
              type: "writeText",
              tempId: "tmp_answer",
              position: { x: 80, y: 120 },
              text: "2 + 3 = 5",
              fontSize: 28,
              maxWidth: 500,
            },
          ],
        },
        patchHash: "a".repeat(64),
        patchBytes: 256,
        affectedNodeIds: ["tmp_answer"],
        riskClass: "low",
      },
      editor,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "draw",
      x: 80,
      y: 120,
      props: { isComplete: true, isPen: true },
      meta: {
        fabric: {
          nodeId: "tmp_answer",
          nodeType: "drawing",
          penText: "2 + 3 = 5",
        },
      },
    });
    const props = created[0]?.props as Record<string, unknown>;
    expect(Array.isArray(props.segments) && props.segments.length > 1).toBe(true);
    expect(() => drawShapeProps.segments.validate(props.segments)).not.toThrow();
  });

  it("applies a compiled Unicode answer as visible native rich-text canvas content", async () => {
    const created: Array<Record<string, unknown>> = [];
    const editor = {
      getInstanceState: () => ({ isReadonly: false }),
      markHistoryStoppingPoint: () => "mark:test",
      run: (callback: () => void) => callback(),
      createShape: (input: Record<string, unknown>) => created.push(input),
      reparentShapes: () => undefined,
      bailToMark: () => undefined,
    } as unknown as Editor;
    const context = buildAuthorizedBoardScene({
      snapshot: { nodes: [], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 1_200, height: 800 },
    });
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Write the exact mathematical answer.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [
        {
          kind: "composeText",
          key: "answer",
          presentation: "typed",
          blocks: [{ role: "answer", text: "x = 4 ⇒ ∀ x ∈ ℝ" }],
        },
      ],
    });
    const patch = compileBoardProposal({
      proposal,
      scene: context,
      base: {
        workspaceId: "workspace-1",
        boardId: "board-1",
        documentGenerationId: "generation-1",
        durableSequence: 1,
      },
    });
    const createdOperation = patch.operations[0];
    if (createdOperation?.type !== "createNode") throw new Error("Invalid compiled fixture");

    await applyTldrawProposal(
      {
        patch,
        patchHash: "b".repeat(64),
        patchBytes: JSON.stringify(patch).length,
        affectedNodeIds: [createdOperation.tempId],
        riskClass: "low",
      },
      editor,
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: "geo",
      meta: {
        fabric: {
          nodeId: createdOperation.tempId,
          nodeType: "summary",
          title: "x = 4 ⇒ ∀ x ∈ ℝ",
        },
      },
    });
    expect(JSON.stringify(created[0])).toContain("x = 4 ⇒ ∀ x ∈ ℝ");
    expect(created[0]?.type).not.toBe("draw");

    const createdRecord = created[0]!;
    const storedRecord = {
      typeName: "shape",
      rotation: 0,
      index: "a1",
      parentId: "page:main",
      isLocked: false,
      opacity: 1,
      ...createdRecord,
    };
    const document = createFabricTldrawDocument({
      store: { [String(createdRecord.id)]: storedRecord },
      schema: { schemaVersion: 2, sequences: {} },
    });
    expect(document).not.toBeNull();
    const projection = projectTldrawDocument(document!);
    expect(projection.nodes[0]?.meta).toBe("tldraw:geo");
    expect(verifyApprovedPatchProjection(patch, projection)).toEqual({ ok: true });
  });

  it("renders an AI heading as a strong native sans title card", async () => {
    const created: Array<Record<string, unknown>> = [];
    const editor = {
      getInstanceState: () => ({ isReadonly: false }),
      markHistoryStoppingPoint: () => "mark:heading",
      run: (callback: () => void) => callback(),
      createShape: (input: Record<string, unknown>) => created.push(input),
      reparentShapes: () => undefined,
      bailToMark: () => undefined,
    } as unknown as Editor;
    const proposal = BoardProposalSchema.parse({
      schemaVersion: 1,
      kind: "proposal",
      summary: "Explain the system.",
      placement: "viewport-center",
      flow: "vertical",
      actions: [{
        kind: "composeText",
        key: "heading",
        presentation: "typed",
        blocks: [{ role: "heading", text: "How the system works" }],
      }],
    });
    const patch = compileBoardProposal({
      proposal,
      scene: buildAuthorizedBoardScene({
        snapshot: { nodes: [], edges: [] },
        selection: [],
        viewport: { x: 0, y: 0, width: 1_200, height: 800 },
      }),
      base: {
        workspaceId: "workspace-1",
        boardId: "board-1",
        documentGenerationId: "generation-1",
        durableSequence: 1,
      },
    });

    await applyTldrawProposal({
      patch,
      patchHash: "c".repeat(64),
      patchBytes: JSON.stringify(patch).length,
      affectedNodeIds: patch.operations.flatMap((operation) =>
        operation.type === "createNode" ? [operation.tempId] : []),
      riskClass: "low",
    }, editor);

    expect(created[0]).toMatchObject({
      type: "geo",
      props: {
        color: "blue",
        labelColor: "white",
        fill: "solid",
        dash: "solid",
        font: "sans",
        size: "l",
        align: "start",
      },
    });
  });

  it("renders AI connectors with quiet native arrow styling", async () => {
    const created: Array<Record<string, unknown>> = [];
    const bounds = new Map<string, { midX: number; midY: number }>();
    const bindings: unknown[] = [];
    const editor = {
      getInstanceState: () => ({ isReadonly: false }),
      markHistoryStoppingPoint: () => "mark:connector",
      run: (callback: () => void) => callback(),
      getCurrentPageShapes: () => [],
      createShape: (input: Record<string, unknown>) => {
        created.push(input);
        if (input.type !== "arrow") {
          const props = input.props as { w: number; h: number };
          bounds.set(String(input.id), {
            midX: Number(input.x) + props.w / 2,
            midY: Number(input.y) + props.h / 2,
          });
        }
      },
      getShapePageBounds: (id: string) => bounds.get(id),
      createBindings: (input: unknown[]) => bindings.push(...input),
      reparentShapes: () => undefined,
      bailToMark: () => undefined,
    } as unknown as Editor;
    const patch = {
      schemaVersion: 1,
      summary: "Connect two steps.",
      base: {
        workspaceId: "workspace-1",
        boardId: "board-1",
        documentGenerationId: "generation-1",
        durableSequence: 1,
      },
      operations: [
        {
          type: "createNode",
          tempId: "tmp_ai_connector_a",
          nodeType: "diamond",
          position: { x: 0, y: 0 },
          size: { width: 288, height: 144 },
          content: { title: "Start", body: "Check whether the request is ready." },
          appearance: { fill: "sky", textColor: "ink" },
        },
        {
          type: "createNode",
          tempId: "tmp_ai_connector_b",
          nodeType: "rectangle",
          position: { x: 420, y: 0 },
          size: { width: 288, height: 144 },
          content: { title: "Finish" },
          appearance: { fill: "mint", textColor: "ink" },
        },
        {
          type: "createConnector",
          tempId: "tmp_ai_connector_edge",
          sourceId: "tmp_ai_connector_a",
          targetId: "tmp_ai_connector_b",
          route: "straight",
          label: "next",
        },
      ],
    } satisfies CanvasPatch;

    await applyTldrawProposal({
      patch,
      patchHash: "e".repeat(64),
      patchBytes: JSON.stringify(patch).length,
      affectedNodeIds: ["tmp_ai_connector_a", "tmp_ai_connector_b"],
      riskClass: "low",
    }, editor);

    expect(created[2]).toMatchObject({
      type: "arrow",
      props: {
        kind: "arc",
        color: "grey",
        labelColor: "black",
        fill: "solid",
        dash: "solid",
        size: "s",
        font: "sans",
        arrowheadStart: "none",
        arrowheadEnd: "arrow",
      },
    });
    expect(created[0]).toMatchObject({
      type: "geo",
      props: {
        geo: "diamond",
        align: "middle",
        verticalAlign: "middle",
      },
    });
    expect(bindings).toHaveLength(2);
  });

  it("round-trips an AI note through a real tldraw store with exact contract dimensions", async () => {
    const shapeUtils = [...defaultShapeUtils];
    const bindingUtils = [...defaultBindingUtils];
    const store = createTLStore({ shapeUtils, bindingUtils });
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new Editor({
      store,
      shapeUtils,
      bindingUtils,
      tools: [],
      getContainer: () => container,
      textOptions: {
        addFontsFromNode: (_node, state) => state,
        tipTapConfig: { extensions: [Document, Paragraph, Text] },
      },
    });
    const patch = {
      schemaVersion: 1,
      summary: "Add an exact-size decision note.",
      base: {
        workspaceId: "workspace-1",
        boardId: "board-1",
        documentGenerationId: "generation-1",
        durableSequence: 1,
      },
      operations: [
        {
          type: "createNode",
          tempId: "tmp_ai_note_001",
          nodeType: "note",
          position: { x: 140, y: 90 },
          size: { width: 320, height: 180 },
          content: { title: "Decision", body: "Ship the reliable agent." },
          appearance: { fill: "butter" },
        },
      ],
    } satisfies CanvasPatch;

    try {
      await applyTldrawProposal(
        {
          patch,
          patchHash: "d".repeat(64),
          patchBytes: JSON.stringify(patch).length,
          affectedNodeIds: ["tmp_ai_note_001"],
          riskClass: "low",
        },
        editor,
      );

      const nativeShape = editor.getCurrentPageShapes()[0];
      if (!nativeShape) throw new Error("AI note was not created");
      expect(nativeShape).toMatchObject({
        type: "geo",
        x: 140,
        y: 90,
        props: {
          geo: "rectangle",
          w: 320,
          h: 180,
          dash: "solid",
          fill: "semi",
          font: "sans",
          size: "m",
          align: "start",
          verticalAlign: "start",
        },
        meta: {
          fabric: {
            kind: "node",
            nodeId: "tmp_ai_note_001",
            nodeType: "note",
            title: "Decision",
            body: "Ship the reliable agent.",
          },
        },
      });

      const document = createFabricTldrawDocument(
        editor.store.getStoreSnapshot("document"),
      );
      expect(document).not.toBeNull();
      const projection = projectTldrawDocument(document!);
      expect(projection.nodes).toEqual([
        expect.objectContaining({
          id: "tmp_ai_note_001",
          type: "note",
          title: "Decision",
          body: "Ship the reliable agent.",
          x: 140,
          y: 90,
          width: 320,
          height: 180,
          meta: "tldraw:geo",
        }),
      ]);
      expect(verifyApprovedPatchProjection(patch, projection)).toEqual({ ok: true });
    } finally {
      editor.dispose();
      container.remove();
    }
  });
});
