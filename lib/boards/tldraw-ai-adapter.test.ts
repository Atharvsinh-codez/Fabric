import { describe, expect, it } from "vitest";
import type { Editor, TLShape, TLShapeId } from "tldraw";

import { serializeTldrawAiSelection } from "./tldraw-ai-adapter";
import type { CanvasNode, NodeType } from "../types";

function shape(id: string, type: string, nodeId = `node-${id}`): TLShape {
  return {
    id: `shape:${id}`,
    type,
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
});
