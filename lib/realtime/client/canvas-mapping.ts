import * as Y from "yjs";
import { z } from "zod";

import type { CanvasEdge, CanvasNode } from "../../types";

const safeText = (maximum: number) =>
  z
    .string()
    .max(maximum)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value));
const stableId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const size = z.number().finite().min(8).max(100_000);
const safeColour = z
  .string()
  .regex(/^(?:transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8})$/);

export const canvasNodeSchema = z
  .object({
    id: stableId,
    type: z.enum(["frame", "note", "text", "rectangle", "ellipse", "image", "summary"]),
    title: safeText(500),
    body: safeText(50_000).optional(),
    x: coordinate,
    y: coordinate,
    width: size,
    height: size,
    fill: safeColour,
    textColor: safeColour.optional(),
    locked: z.boolean().optional(),
    viewportWriteSafe: z.boolean().optional(),
    hasDescendants: z.boolean().optional(),
    parentId: stableId.optional(),
    tag: safeText(120).optional(),
    meta: safeText(2_000).optional(),
  })
  .strict();

export const canvasEdgeSchema = z
  .object({
    id: stableId,
    sourceId: stableId,
    targetId: stableId,
    route: z.enum(["straight", "elbow"]),
  })
  .strict();

export const canvasDocumentSchema = z
  .object({
    nodes: z.array(canvasNodeSchema).max(20_000),
    edges: z.array(canvasEdgeSchema).max(40_000),
  })
  .strict()
  .superRefine((document, context) => {
    const nodeIds = new Set<string>();
    for (const node of document.nodes) {
      if (nodeIds.has(node.id)) {
        context.addIssue({ code: "custom", message: "Node IDs must be unique." });
      }
      nodeIds.add(node.id);
    }
    const edgeIds = new Set<string>();
    for (const edge of document.edges) {
      if (edgeIds.has(edge.id)) {
        context.addIssue({ code: "custom", message: "Edge IDs must be unique." });
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.sourceId) || !nodeIds.has(edge.targetId)) {
        context.addIssue({ code: "custom", message: "Edges must reference existing nodes." });
      }
    }
  });

export type CanvasDocument = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
};

export type CanvasReadResult = CanvasDocument & {
  rejectedNodeIds: string[];
  rejectedEdgeIds: string[];
};

const ROOT_KEY = "fabric.canvas.v1";
const NODES_KEY = "nodes";
const NODE_ORDER_KEY = "nodeOrder";
const EDGES_KEY = "edges";
const EDGE_ORDER_KEY = "edgeOrder";

type CanvasTypes = {
  root: Y.Map<unknown>;
  nodes: Y.Map<Y.Map<unknown>>;
  nodeOrder: Y.Array<string>;
  edges: Y.Map<Y.Map<unknown>>;
  edgeOrder: Y.Array<string>;
};

function getOrCreateMap<T>(root: Y.Map<unknown>, key: string): Y.Map<T> {
  const current = root.get(key);
  if (current instanceof Y.Map) return current as Y.Map<T>;
  const created = new Y.Map<T>();
  root.set(key, created);
  return created;
}

function getOrCreateArray<T>(root: Y.Map<unknown>, key: string): Y.Array<T> {
  const current = root.get(key);
  if (current instanceof Y.Array) return current as Y.Array<T>;
  const created = new Y.Array<T>();
  root.set(key, created);
  return created;
}

export function getCanvasTypes(document: Y.Doc): CanvasTypes {
  const root = document.getMap<unknown>(ROOT_KEY);
  return {
    root,
    nodes: getOrCreateMap<Y.Map<unknown>>(root, NODES_KEY),
    nodeOrder: getOrCreateArray<string>(root, NODE_ORDER_KEY),
    edges: getOrCreateMap<Y.Map<unknown>>(root, EDGES_KEY),
    edgeOrder: getOrCreateArray<string>(root, EDGE_ORDER_KEY),
  };
}

function replaceMapValues(target: Y.Map<unknown>, values: Record<string, unknown>): void {
  for (const key of [...target.keys()]) {
    if (!(key in values)) target.delete(key);
  }
  for (const [key, value] of Object.entries(values)) {
    if (target.get(key) !== value) target.set(key, value);
  }
}

function upsertRecord(
  collection: Y.Map<Y.Map<unknown>>,
  id: string,
  values: Record<string, unknown>,
): void {
  const current = collection.get(id);
  if (current instanceof Y.Map) {
    replaceMapValues(current, values);
    return;
  }
  const created = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(values)) created.set(key, value);
  collection.set(id, created);
}

function replaceOrder(order: Y.Array<string>, next: string[]): void {
  const current = order.toArray();
  if (current.length === next.length && current.every((id, index) => id === next[index])) {
    return;
  }
  if (current.length > 0) order.delete(0, current.length);
  if (next.length > 0) order.insert(0, next);
}

export function writeCanvasToYDoc(
  document: Y.Doc,
  canvas: CanvasDocument,
  origin?: unknown,
): CanvasDocument {
  const parsed = canvasDocumentSchema.parse(canvas) as CanvasDocument;
  document.transact(() => {
    const types = getCanvasTypes(document);
    const nodeIds = new Set(parsed.nodes.map((node) => node.id));
    const edgeIds = new Set(parsed.edges.map((edge) => edge.id));

    for (const id of [...types.nodes.keys()]) {
      if (!nodeIds.has(id)) types.nodes.delete(id);
    }
    for (const id of [...types.edges.keys()]) {
      if (!edgeIds.has(id)) types.edges.delete(id);
    }
    for (const node of parsed.nodes) upsertRecord(types.nodes, node.id, { ...node });
    for (const edge of parsed.edges) upsertRecord(types.edges, edge.id, { ...edge });
    replaceOrder(types.nodeOrder, parsed.nodes.map((node) => node.id));
    replaceOrder(types.edgeOrder, parsed.edges.map((edge) => edge.id));
  }, origin);
  return parsed;
}

function orderedIds(order: readonly string[], records: Y.Map<Y.Map<unknown>>): string[] {
  const available = new Set(records.keys());
  const result: string[] = [];
  for (const id of order) {
    if (available.delete(id)) result.push(id);
  }
  return [...result, ...[...available].sort()];
}

export function readCanvasFromYDoc(document: Y.Doc): CanvasReadResult {
  const root = document.getMap<unknown>(ROOT_KEY);
  const nodesType = root.get(NODES_KEY);
  const edgesType = root.get(EDGES_KEY);
  if (!(nodesType instanceof Y.Map) || !(edgesType instanceof Y.Map)) {
    return { nodes: [], edges: [], rejectedNodeIds: [], rejectedEdgeIds: [] };
  }
  const nodesMap = nodesType as Y.Map<Y.Map<unknown>>;
  const edgesMap = edgesType as Y.Map<Y.Map<unknown>>;
  const nodeOrderType = root.get(NODE_ORDER_KEY);
  const edgeOrderType = root.get(EDGE_ORDER_KEY);
  const nodeOrder = nodeOrderType instanceof Y.Array ? nodeOrderType.toArray() : [];
  const edgeOrder = edgeOrderType instanceof Y.Array ? edgeOrderType.toArray() : [];
  const nodes: CanvasNode[] = [];
  const rejectedNodeIds: string[] = [];
  for (const id of orderedIds(nodeOrder, nodesMap)) {
    const record = nodesMap.get(id);
    const parsed = canvasNodeSchema.safeParse(record?.toJSON());
    if (parsed.success && parsed.data.id === id) nodes.push(parsed.data as CanvasNode);
    else rejectedNodeIds.push(id);
  }

  const acceptedNodeIds = new Set(nodes.map((node) => node.id));
  const edges: CanvasEdge[] = [];
  const rejectedEdgeIds: string[] = [];
  for (const id of orderedIds(edgeOrder, edgesMap)) {
    const record = edgesMap.get(id);
    const parsed = canvasEdgeSchema.safeParse(record?.toJSON());
    if (
      parsed.success &&
      parsed.data.id === id &&
      acceptedNodeIds.has(parsed.data.sourceId) &&
      acceptedNodeIds.has(parsed.data.targetId)
    ) {
      edges.push(parsed.data as CanvasEdge);
    } else {
      rejectedEdgeIds.push(id);
    }
  }
  return { nodes, edges, rejectedNodeIds, rejectedEdgeIds };
}
