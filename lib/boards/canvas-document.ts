import type { BoardDocument, JsonValue } from "@/db/schema/product";
import {
  asStoredTldrawDocument,
  readTldrawDocument,
  type FabricTldrawDocument,
} from "./tldraw-document";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

const NODE_TYPES = new Set<CanvasNode["type"]>([
  "frame",
  "note",
  "text",
  "rectangle",
  "ellipse",
  "diamond",
  "triangle",
  "hexagon",
  "image",
  "drawing",
  "summary",
]);

const EDGE_ROUTES = new Set<CanvasEdge["route"]>(["straight", "elbow"]);

export type CanvasDocumentSnapshot = Readonly<{
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /**
   * The lossless tldraw document checkpoint. `nodes` and `edges` remain the
   * bounded semantic projection used by AI and public sharing.
   */
  tldraw?: FabricTldrawDocument | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isCanvasNode(value: unknown): value is CanvasNode {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.type === "string" &&
    NODE_TYPES.has(value.type as CanvasNode["type"]) &&
    typeof value.title === "string" &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    typeof value.fill === "string" &&
    optionalString(value.body) &&
    optionalString(value.textColor) &&
    (value.locked === undefined || typeof value.locked === "boolean") &&
    optionalString(value.parentId) &&
    optionalString(value.tag) &&
    optionalString(value.meta)
  );
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.sourceId === "string" &&
    value.sourceId.length > 0 &&
    typeof value.targetId === "string" &&
    value.targetId.length > 0 &&
    typeof value.route === "string" &&
    EDGE_ROUTES.has(value.route as CanvasEdge["route"])
  );
}

export function readCanvasDocument(document: BoardDocument): CanvasDocumentSnapshot {
  const seenNodeIds = new Set<string>();
  const nodes = Array.isArray(document.nodes)
    ? document.nodes.filter((node): node is CanvasNode => {
        if (!isCanvasNode(node) || seenNodeIds.has(node.id)) return false;
        seenNodeIds.add(node.id);
        return true;
      })
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(document.edges)
    ? document.edges.filter(
        (edge): edge is CanvasEdge =>
          isCanvasEdge(edge) &&
          nodeIds.has(edge.sourceId) &&
          nodeIds.has(edge.targetId),
      )
    : [];

  return { nodes, edges, tldraw: readTldrawDocument(document) };
}

function asJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function writeCanvasDocument(
  current: BoardDocument,
  snapshot: CanvasDocumentSnapshot,
): BoardDocument {
  const next: BoardDocument = {
    ...current,
    version: 1,
    nodes: asJsonValue(snapshot.nodes),
    edges: asJsonValue(snapshot.edges),
  };
  if (snapshot.tldraw !== undefined) {
    delete next.tldrawSnapshot;
    if (snapshot.tldraw === null) delete next.tldraw;
    else next.tldraw = asStoredTldrawDocument(snapshot.tldraw);
  }
  return next;
}

export function documentFingerprint(document: BoardDocument): string {
  const canonicalize = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  };

  return JSON.stringify(canonicalize(document));
}
