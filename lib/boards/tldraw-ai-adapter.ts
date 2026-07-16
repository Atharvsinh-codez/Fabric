"use client";

import {
  createShapeId,
  toRichText,
  type Editor,
  type TLParentId,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from "tldraw";

import type { FabricWhiteboardAiAdapter } from "@/components/fabric-whiteboard/ai-panel";
import type { CanvasOperation } from "@/lib/ai/canvas-patch";
import type { ProposalReadyPayload } from "@/lib/ai/contracts";
import type { AiProposalRequest } from "@/lib/ai/proposal-request";
import { captureTldrawCheckpoint } from "@/lib/boards/tldraw-store-adapter";
import { canvasNodeIdForTldrawShapeRecord } from "@/lib/boards/tldraw-document";
import type { CanvasNode } from "@/lib/types";

const colorTokens = {
  surface: "white",
  ink: "black",
  sky: "blue",
  mint: "green",
  butter: "yellow",
  lavender: "violet",
  rose: "red",
  fog: "grey",
} as const;

function resolveNodeId(
  editor: Editor,
  id: string,
  temporaryIds: ReadonlyMap<string, TLShapeId>,
): TLShapeId {
  const direct = id.startsWith("shape:") && editor.getShape(id as TLShapeId)
    ? id as TLShapeId
    : null;
  const semantic = editor
    .getCurrentPageShapes()
    .find(
      (shape) =>
        canvasNodeIdForTldrawShapeRecord(
          shape as unknown as Record<string, unknown>,
        ) === id,
    )?.id;
  const resolved = temporaryIds.get(id) ?? direct ?? semantic ?? null;
  if (!resolved) throw new Error(`The proposal references an unknown tldraw shape: ${id}`);
  return resolved;
}

function contentText(content: { title?: string; body?: string }): string {
  return [content.title, content.body].filter(Boolean).join("\n\n");
}

function richTextValue(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const ownText = typeof record.text === "string" ? record.text : "";
  const content = Array.isArray(record.content)
    ? record.content.map(richTextValue).join(record.type === "doc" ? "\n" : "")
    : "";
  return `${ownText}${content}`.trim();
}

function shapePropsForNode(operation: Extract<CanvasOperation, { type: "createNode" }>) {
  const text = contentText(operation.content);
  const color = operation.appearance?.fill
    ? colorTokens[operation.appearance.fill]
    : "blue";
  if (operation.nodeType === "frame") {
    return {
      type: "frame",
      props: {
        w: operation.size.width,
        h: operation.size.height,
        name: operation.content.title,
        color,
      },
    } as const;
  }
  if (operation.nodeType === "note") {
    return {
      type: "note",
      props: { color, labelColor: "black", richText: toRichText(text) },
    } as const;
  }
  if (operation.nodeType === "text") {
    return {
      type: "text",
      props: {
        color,
        w: operation.size.width,
        autoSize: false,
        richText: toRichText(text),
      },
    } as const;
  }
  return {
    type: "geo",
    props: {
      geo: operation.nodeType === "ellipse" ? "ellipse" : "rectangle",
      w: operation.size.width,
      h: operation.size.height,
      color,
      labelColor: "black",
      fill: "semi",
      richText: toRichText(text),
    },
  } as const;
}

function createNode(
  editor: Editor,
  operation: Extract<CanvasOperation, { type: "createNode" }>,
  temporaryIds: Map<string, TLShapeId>,
): void {
  const id = createShapeId();
  temporaryIds.set(operation.tempId, id);
  const parentId = operation.parentId
    ? resolveNodeId(editor, operation.parentId, temporaryIds)
    : undefined;
  const shape = shapePropsForNode(operation);
  editor.createShape({
    id,
    type: shape.type,
    x: operation.position.x,
    y: operation.position.y,
    props: shape.props,
    meta: {
      fabric: {
        kind: "node",
        nodeId: operation.tempId,
        nodeType: operation.nodeType,
        ...operation.content,
        ...(operation.appearance?.fill
          ? { fillToken: operation.appearance.fill }
          : {}),
        ...(operation.appearance?.textColor
          ? { textColorToken: operation.appearance.textColor }
          : {}),
      },
    },
  } as TLShapePartial);
  if (parentId) editor.reparentShapes([id], parentId);
  if (operation.nodeType === "note") {
    const created = editor.getShape(id);
    const bounds = created ? editor.getShapePageBounds(created) : null;
    if (created && bounds && bounds.w > 0 && bounds.h > 0) {
      editor.resizeShape(created, {
        x: operation.size.width / bounds.w,
        y: operation.size.height / bounds.h,
      });
    }
  }
}

function updatedShapeProps(
  shape: TLShape,
  operation: Extract<CanvasOperation, { type: "updateNode" }>,
): Record<string, unknown> {
  const props = shape.props as unknown as Record<string, unknown>;
  const next = { ...props };
  if (operation.content) {
    const currentFabric = (
      shape.meta.fabric && typeof shape.meta.fabric === "object"
        ? shape.meta.fabric
        : {}
    ) as Record<string, unknown>;
    const currentText = richTextValue(props.richText);
    const [currentTitle = "", ...currentBody] = currentText.split(/\n+/);
    const title = operation.content.title ?? String(currentFabric.title ?? currentTitle ?? "Untitled");
    const body = operation.content.body ?? String(currentFabric.body ?? currentBody.join("\n"));
    if (shape.type === "frame") next.name = title;
    else if ("richText" in props) next.richText = toRichText(contentText({ title, body }));
  }
  if (operation.appearance?.fill) {
    const color = colorTokens[operation.appearance.fill];
    if ("color" in props) next.color = color;
  }
  if (operation.appearance?.textColor) {
    const color = operation.appearance.textColor === "surface"
      ? "white"
      : operation.appearance.textColor === "muted"
        ? "grey"
        : "black";
    if ("labelColor" in props) next.labelColor = color;
    else if (shape.type === "text") next.color = color;
  }
  return next;
}

function updateNode(
  editor: Editor,
  operation: Extract<CanvasOperation, { type: "updateNode" }>,
  temporaryIds: ReadonlyMap<string, TLShapeId>,
): void {
  const id = resolveNodeId(editor, operation.nodeId, temporaryIds);
  const shape = editor.getShape(id);
  if (!shape) throw new Error(`The proposal target ${operation.nodeId} no longer exists.`);
  const fabric = (
    shape.meta.fabric && typeof shape.meta.fabric === "object"
      ? shape.meta.fabric
      : {}
  ) as Record<string, unknown>;
  editor.updateShape({
    id,
    type: shape.type,
    props: updatedShapeProps(shape, operation),
    meta: {
      ...shape.meta,
      fabric: {
        ...fabric,
        ...(operation.content ?? {}),
        ...(operation.appearance?.fill
          ? { fillToken: operation.appearance.fill }
          : {}),
        ...(operation.appearance?.textColor
          ? { textColorToken: operation.appearance.textColor }
          : {}),
      },
    },
  } as TLShapePartial);
}

function moveNode(
  editor: Editor,
  operation: Extract<CanvasOperation, { type: "moveNode" }>,
  temporaryIds: ReadonlyMap<string, TLShapeId>,
): void {
  const id = resolveNodeId(editor, operation.nodeId, temporaryIds);
  const shape = editor.getShape(id);
  if (!shape) throw new Error(`The proposal target ${operation.nodeId} no longer exists.`);
  if (operation.parentId !== undefined) {
    const parentId: TLParentId = operation.parentId === null
      ? editor.getCurrentPageId()
      : resolveNodeId(editor, operation.parentId, temporaryIds);
    editor.reparentShapes([id], parentId);
  }
  const localPosition = editor.getPointInParentSpace(id, operation.position);
  editor.updateShape({
    id,
    type: shape.type,
    x: localPosition.x,
    y: localPosition.y,
  });
}

function resizeNode(
  editor: Editor,
  operation: Extract<CanvasOperation, { type: "resizeNode" }>,
  temporaryIds: ReadonlyMap<string, TLShapeId>,
): void {
  const id = resolveNodeId(editor, operation.nodeId, temporaryIds);
  const shape = editor.getShape(id);
  const bounds = shape ? editor.getShapePageBounds(shape) : null;
  if (!shape || !bounds || bounds.w <= 0 || bounds.h <= 0) {
    throw new Error(`The proposal target ${operation.nodeId} cannot be resized.`);
  }
  editor.resizeShape(shape, {
    x: operation.size.width / bounds.w,
    y: operation.size.height / bounds.h,
  });
}

function createConnector(
  editor: Editor,
  operation: Extract<CanvasOperation, { type: "createConnector" }>,
  temporaryIds: Map<string, TLShapeId>,
): void {
  const sourceId = resolveNodeId(editor, operation.sourceId, temporaryIds);
  const targetId = resolveNodeId(editor, operation.targetId, temporaryIds);
  const sourceBounds = editor.getShapePageBounds(sourceId);
  const targetBounds = editor.getShapePageBounds(targetId);
  if (!sourceBounds || !targetBounds) throw new Error("A connector endpoint no longer exists.");
  const start = { x: sourceBounds.midX, y: sourceBounds.midY };
  const end = { x: targetBounds.midX, y: targetBounds.midY };
  const id = createShapeId();
  temporaryIds.set(operation.tempId, id);
  editor.createShape({
    id,
    type: "arrow",
    x: start.x,
    y: start.y,
    props: {
      kind: operation.route === "elbow" ? "elbow" : "arc",
      color: "blue",
      start: { x: 0, y: 0 },
      end: { x: end.x - start.x, y: end.y - start.y },
    },
    meta: {
      fabric: {
        kind: "edge",
        edgeId: operation.tempId,
        sourceId: operation.sourceId,
        targetId: operation.targetId,
        route: operation.route,
      },
    },
  } as TLShapePartial);
}

function applyOperation(
  editor: Editor,
  operation: CanvasOperation,
  temporaryIds: Map<string, TLShapeId>,
): void {
  if (operation.type === "createNode") createNode(editor, operation, temporaryIds);
  else if (operation.type === "updateNode") updateNode(editor, operation, temporaryIds);
  else if (operation.type === "moveNode") moveNode(editor, operation, temporaryIds);
  else if (operation.type === "resizeNode") resizeNode(editor, operation, temporaryIds);
  else if (operation.type === "createConnector") {
    createConnector(editor, operation, temporaryIds);
  } else {
    const id = resolveNodeId(editor, operation.nodeId, temporaryIds);
    if (!editor.getShape(id)) throw new Error(`The proposal target ${operation.nodeId} no longer exists.`);
    editor.deleteShapes([id]);
  }
}

export async function applyTldrawProposal(
  proposal: ProposalReadyPayload,
  editor: Editor,
): Promise<void> {
  if (editor.getInstanceState().isReadonly) {
    throw new Error("A read-only board cannot apply an AI proposal.");
  }
  const mark = editor.markHistoryStoppingPoint("Apply Fabric AI proposal");
  const temporaryIds = new Map<string, TLShapeId>();
  try {
    editor.run(() => {
      for (const operation of proposal.patch.operations) {
        applyOperation(editor, operation, temporaryIds);
      }
    });
    editor.markHistoryStoppingPoint("Applied Fabric AI proposal");
  } catch (error) {
    editor.bailToMark(mark);
    throw error;
  }
}

function selectedLeafShapes(editor: Editor): TLShape[] {
  const leaves: TLShape[] = [];
  const visitedShapeIds = new Set<TLShapeId>();

  const visit = (shape: TLShape): void => {
    if (visitedShapeIds.has(shape.id)) return;
    visitedShapeIds.add(shape.id);

    if (shape.type !== "group") {
      leaves.push(shape);
      return;
    }

    for (const childId of editor.getSortedChildIdsForParent(shape.id)) {
      const child = editor.getShape(childId);
      if (child) visit(child);
    }
  };

  for (const shape of editor.getSelectedShapes()) visit(shape);
  return leaves;
}

export function serializeTldrawAiSelection(
  editor: Editor,
  nodes: readonly CanvasNode[],
): AiProposalRequest["selection"] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const includedNodeIds = new Set<string>();
  const selection: AiProposalRequest["selection"][number][] = [];

  for (const shape of selectedLeafShapes(editor)) {
    const nodeId = canvasNodeIdForTldrawShapeRecord(
      shape as unknown as Record<string, unknown>,
    );
    if (includedNodeIds.has(nodeId)) continue;
    const node = nodesById.get(nodeId);
    if (!node) continue;

    includedNodeIds.add(node.id);
    selection.push({
      id: node.id,
      type: node.type,
      title: node.title,
      ...(node.body !== undefined ? { body: node.body } : {}),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      ...(node.locked !== undefined ? { locked: node.locked } : {}),
      ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
      ...(node.tag !== undefined ? { tag: node.tag } : {}),
    });
    if (selection.length === 40) break;
  }

  return selection;
}

export const tldrawWhiteboardAiAdapter: FabricWhiteboardAiAdapter = {
  getSelection(editor) {
    const checkpoint = captureTldrawCheckpoint(editor.store);
    return serializeTldrawAiSelection(editor, checkpoint.nodes);
  },
  applyProposal: applyTldrawProposal,
};
