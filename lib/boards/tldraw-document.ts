import type { TLShapeId, TLShapePartial } from "tldraw";

import type { BoardDocument, JsonValue } from "@/db/schema/product";
import type { CanvasSourceGeometry } from "@/lib/ai/canvas-patch";
import type { CanvasEdge, CanvasNode, NodeType } from "@/lib/types";

export const FABRIC_TLDRAW_DOCUMENT_VERSION = 1 as const;
export const TLDRAW_DOCUMENT_MAX_RECORDS = 5_000;
export const TLDRAW_DOCUMENT_MAX_BYTES = 750_000;

export const TLDRAW_RECORD_MAX_BYTES = 160_000;
export const TLDRAW_JSON_MAX_DEPTH = 40;
// Leave headroom under the board API's 25k JSON-entry ceiling for the
// semantic nodes/edges projection and top-level metadata.
export const TLDRAW_JSON_MAX_ENTRIES = 18_000;
const TLDRAW_ID_MAX_LENGTH = 256;
const ALLOWED_RECORD_TYPES = new Set([
  "asset",
  "binding",
  "document",
  "page",
  "shape",
]);
const CANVAS_NODE_TYPES = new Set<NodeType>([
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
const SAFE_CANVAS_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SAFE_TLDRAW_ID = /^[A-Za-z][A-Za-z0-9_-]*:[^\u0000-\u0020\u007f]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export type TldrawSerializedRecord = Readonly<Record<string, JsonValue>> & {
  readonly id: string;
  readonly typeName: string;
};

export type TldrawStoreSnapshot = Readonly<{
  store: Readonly<Record<string, TldrawSerializedRecord>>;
  schema: Readonly<Record<string, JsonValue>>;
}>;

export type FabricTldrawDocument = Readonly<{
  version: typeof FABRIC_TLDRAW_DOCUMENT_VERSION;
  snapshot: TldrawStoreSnapshot;
}>;

export type TldrawCanvasProjection = Readonly<{
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

type SafeJsonMetrics = Readonly<{
  entries: number;
  maxDepth: number;
}>;

function inspectSafeJson(value: unknown): SafeJsonMetrics | null {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let entries = 0;
  let maxDepth = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    entries += 1;
    maxDepth = Math.max(maxDepth, current.depth);
    if (entries > TLDRAW_JSON_MAX_ENTRIES || current.depth > TLDRAW_JSON_MAX_DEPTH) {
      return null;
    }

    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return null;
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    if (!isRecord(current.value)) return null;
    const prototype = Object.getPrototypeOf(current.value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    for (const [key, item] of Object.entries(current.value)) {
      if (
        key.length > 256 ||
        key === "__proto__" ||
        key === "prototype" ||
        key === "constructor"
      ) {
        return null;
      }
      pending.push({ value: item, depth: current.depth + 1 });
    }
  }
  return { entries, maxDepth };
}

function isSafeJson(value: unknown): value is JsonValue {
  return inspectSafeJson(value) !== null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validRecordId(id: unknown, typeName?: string): id is string {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    id.length <= TLDRAW_ID_MAX_LENGTH &&
    SAFE_TLDRAW_ID.test(id) &&
    (typeName === undefined || id.startsWith(`${typeName}:`))
  );
}

function hasValidShapeFields(record: Record<string, unknown>): boolean {
  return (
    typeof record.type === "string" &&
    record.type.length > 0 &&
    record.type.length <= 64 &&
    isFiniteNumber(record.x) &&
    Math.abs(record.x) <= 10_000_000 &&
    isFiniteNumber(record.y) &&
    Math.abs(record.y) <= 10_000_000 &&
    isFiniteNumber(record.rotation) &&
    Math.abs(record.rotation) <= Math.PI * 1_000 &&
    typeof record.index === "string" &&
    record.index.length > 0 &&
    record.index.length <= 128 &&
    validRecordId(record.parentId) &&
    typeof record.isLocked === "boolean" &&
    isFiniteNumber(record.opacity) &&
    record.opacity >= 0 &&
    record.opacity <= 1 &&
    isRecord(record.props) &&
    isRecord(record.meta)
  );
}

function hasValidBindingFields(record: Record<string, unknown>): boolean {
  return (
    typeof record.type === "string" &&
    record.type.length > 0 &&
    record.type.length <= 64 &&
    validRecordId(record.fromId, "shape") &&
    validRecordId(record.toId, "shape") &&
    isRecord(record.props) &&
    isRecord(record.meta)
  );
}

type TldrawRecordAnalysis = Readonly<{
  record: TldrawSerializedRecord;
  bytes: number;
  jsonEntries: number;
  maxDepth: number;
}>;

function analyzeTldrawRecord(
  expectedId: string,
  value: unknown,
): TldrawRecordAnalysis | null {
  if (!isRecord(value) || value.id !== expectedId || typeof value.typeName !== "string") {
    return null;
  }
  const json = inspectSafeJson(value);
  if (
    !ALLOWED_RECORD_TYPES.has(value.typeName) ||
    !validRecordId(value.id, value.typeName) ||
    !json
  ) {
    return null;
  }
  const serialized = JSON.stringify(value);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > TLDRAW_RECORD_MAX_BYTES) return null;
  if (value.typeName === "shape" && !hasValidShapeFields(value)) return null;
  if (value.typeName === "binding" && !hasValidBindingFields(value)) return null;
  if (
    value.typeName === "page" &&
    (typeof value.name !== "string" ||
      value.name.length > 256 ||
      typeof value.index !== "string" ||
      value.index.length > 128 ||
      !isRecord(value.meta))
  ) {
    return null;
  }
  if (value.typeName === "asset" && (!isRecord(value.props) || !isRecord(value.meta))) {
    return null;
  }
  if (value.typeName === "document" && !isRecord(value.meta)) return null;
  return {
    record: JSON.parse(serialized) as TldrawSerializedRecord,
    bytes,
    jsonEntries: json.entries,
    maxDepth: json.maxDepth,
  };
}

export function parseTldrawRecord(
  expectedId: string,
  value: unknown,
): TldrawSerializedRecord | null {
  return analyzeTldrawRecord(expectedId, value)?.record ?? null;
}

type TldrawRecordCost = Readonly<{
  bytes: number;
  jsonEntries: number;
  maxDepth: number;
}>;

export type TldrawRecordBudgetChange = readonly [string, unknown | null];

export type TldrawRecordBudgetResult =
  | Readonly<{
      ok: false;
      reason: "invalid_record" | "document_limit";
    }>
  | Readonly<{
      ok: true;
      entries: readonly (readonly [string, TldrawSerializedRecord | null])[];
      commit: () => void;
    }>;

/**
 * Incremental accounting for the exact collection limits enforced by
 * `tldrawRecordCollectionWithinLimits`. The collection wrapper contributes one
 * JSON entry and one level of nesting around every record.
 */
export class TldrawRecordBudget {
  private readonly costs = new Map<string, TldrawRecordCost>();
  private totalBytes = 0;
  private totalJsonEntries = 1;
  private version = 0;

  static fromRecords(
    records: Iterable<readonly [string, unknown]>,
  ): TldrawRecordBudget | null {
    const additions: TldrawRecordBudgetChange[] = [];
    for (const [id, value] of records) {
      // `null` is the incremental deletion sentinel, but it is never a valid
      // persisted tldraw record during a full collection rebuild.
      if (value === null) return null;
      additions.push([id, value]);
    }
    const budget = new TldrawRecordBudget();
    const prepared = budget.prepareChanges(additions);
    if (!prepared.ok) return null;
    prepared.commit();
    return budget;
  }

  get recordCount(): number {
    return this.costs.size;
  }

  get byteCount(): number {
    return this.totalBytes;
  }

  get jsonEntryCount(): number {
    return this.totalJsonEntries;
  }

  prepareChanges(
    changes: Iterable<TldrawRecordBudgetChange>,
  ): TldrawRecordBudgetResult {
    let nextRecordCount = this.costs.size;
    let nextBytes = this.totalBytes;
    let nextJsonEntries = this.totalJsonEntries;
    const nextCosts = new Map<string, TldrawRecordCost | null>();
    const entries: Array<readonly [string, TldrawSerializedRecord | null]> = [];
    const seen = new Set<string>();

    for (const [id, value] of changes) {
      if (seen.has(id)) return { ok: false, reason: "invalid_record" };
      seen.add(id);
      const previous = this.costs.get(id);
      if (previous) {
        nextBytes -= previous.bytes;
        nextJsonEntries -= previous.jsonEntries;
      }

      if (value === null) {
        if (previous) nextRecordCount -= 1;
        nextCosts.set(id, null);
        entries.push([id, null]);
        continue;
      }

      const analysis = analyzeTldrawRecord(id, value);
      if (!analysis) return { ok: false, reason: "invalid_record" };
      if (!previous) nextRecordCount += 1;
      nextBytes += analysis.bytes;
      nextJsonEntries += analysis.jsonEntries;
      if (analysis.maxDepth + 1 > TLDRAW_JSON_MAX_DEPTH) {
        return { ok: false, reason: "document_limit" };
      }
      nextCosts.set(id, {
        bytes: analysis.bytes,
        jsonEntries: analysis.jsonEntries,
        maxDepth: analysis.maxDepth,
      });
      entries.push([id, analysis.record]);
    }

    if (
      nextRecordCount > TLDRAW_DOCUMENT_MAX_RECORDS ||
      nextBytes > TLDRAW_DOCUMENT_MAX_BYTES ||
      nextJsonEntries > TLDRAW_JSON_MAX_ENTRIES
    ) {
      return { ok: false, reason: "document_limit" };
    }

    const expectedVersion = this.version;
    let committed = false;
    return {
      ok: true,
      entries,
      commit: () => {
        if (committed) return;
        if (this.version !== expectedVersion) {
          throw new Error("The tldraw record budget changed before this update was committed.");
        }
        for (const [id, cost] of nextCosts) {
          if (cost) this.costs.set(id, cost);
          else this.costs.delete(id);
        }
        this.totalBytes = nextBytes;
        this.totalJsonEntries = nextJsonEntries;
        this.version += 1;
        committed = true;
      },
    };
  }
}

export function tldrawRecordCollectionWithinLimits(
  records: Iterable<readonly [string, unknown]>,
): boolean {
  let count = 0;
  let bytes = 0;
  const collected: Record<string, JsonValue> = {};
  for (const [id, value] of records) {
    count += 1;
    if (count > TLDRAW_DOCUMENT_MAX_RECORDS) return false;
    const analysis = analyzeTldrawRecord(id, value);
    if (!analysis) return false;
    collected[id] = analysis.record;
    bytes += analysis.bytes;
    if (bytes > TLDRAW_DOCUMENT_MAX_BYTES) return false;
  }
  return isSafeJson(collected);
}

export function parseTldrawStoreSnapshot(value: unknown): TldrawStoreSnapshot | null {
  if (!isRecord(value) || !isRecord(value.store) || !isRecord(value.schema)) return null;
  const recordEntries = Object.entries(value.store);
  if (recordEntries.length > TLDRAW_DOCUMENT_MAX_RECORDS || !isSafeJson(value.schema)) {
    return null;
  }
  if (
    !Number.isSafeInteger(value.schema.schemaVersion) ||
    Number(value.schema.schemaVersion) < 1 ||
    !isRecord(value.schema.sequences)
  ) {
    return null;
  }
  const records: Record<string, TldrawSerializedRecord> = {};
  for (const [id, record] of recordEntries) {
    const parsed = parseTldrawRecord(id, record);
    if (!parsed) return null;
    records[id] = parsed;
  }
  const snapshot = {
    store: records,
    schema: cloneJson(value.schema) as Readonly<Record<string, JsonValue>>,
  } satisfies TldrawStoreSnapshot;
  return isSafeJson(snapshot) && jsonByteLength(snapshot) <= TLDRAW_DOCUMENT_MAX_BYTES
    ? snapshot
    : null;
}

function snapshotCandidate(value: unknown): unknown {
  if (!isRecord(value)) return null;
  if (value.version === FABRIC_TLDRAW_DOCUMENT_VERSION && value.snapshot !== undefined) {
    return value.snapshot;
  }
  if (isRecord(value.document) && value.document.store !== undefined) {
    return value.document;
  }
  if (value.store !== undefined && value.schema !== undefined) return value;
  return null;
}

export function createFabricTldrawDocument(value: unknown): FabricTldrawDocument | null {
  const snapshot = parseTldrawStoreSnapshot(snapshotCandidate(value));
  return snapshot
    ? { version: FABRIC_TLDRAW_DOCUMENT_VERSION, snapshot }
    : null;
}

export function readTldrawDocument(document: BoardDocument): FabricTldrawDocument | null {
  return createFabricTldrawDocument(document.tldraw ?? document.tldrawSnapshot);
}

export function asStoredTldrawDocument(document: FabricTldrawDocument): JsonValue {
  return cloneJson(document) as JsonValue;
}

function sanitizeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARACTERS, "").trim().slice(0, maximum);
}

function richTextToPlainText(value: unknown): string {
  if (!isRecord(value)) return "";
  const pieces: string[] = [];
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length > 0 && pieces.join("").length < 50_000) {
    const current = pending.pop();
    if (!current || current.depth > 24 || ++visited > 10_000) break;
    if (!isRecord(current.value)) continue;
    if (typeof current.value.text === "string") pieces.push(current.value.text);
    if (Array.isArray(current.value.content)) {
      if (current.value.type === "paragraph" && pieces.length > 0) pieces.push("\n");
      for (let index = current.value.content.length - 1; index >= 0; index -= 1) {
        pending.push({ value: current.value.content[index], depth: current.depth + 1 });
      }
    }
  }
  return sanitizeText(pieces.join("").replace(/\n{3,}/g, "\n\n"), 50_000);
}

function safeCanvasId(value: unknown, fallback: string): string {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    SAFE_CANVAS_ID.test(value)
  ) {
    return value;
  }
  let hash = 2_166_136_261;
  for (const character of fallback) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `tl-${(hash >>> 0).toString(36)}`;
}

function readFabricMeta(record: Record<string, unknown>): Record<string, unknown> {
  const meta = isRecord(record.meta) ? record.meta : {};
  return isRecord(meta.fabric) ? meta.fabric : {};
}

export function canvasNodeIdForTldrawShapeRecord(
  shape: Record<string, unknown>,
): string {
  return safeCanvasId(readFabricMeta(shape).nodeId, String(shape.id ?? "shape"));
}

/** Canonical shape-to-node projection, including deterministic legacy duplicate repair. */
export function projectedCanvasNodeIdMapForTldrawShapeRecords(
  shapes: readonly Record<string, unknown>[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const usedNodeIds = new Set<string>();
  for (const shape of shapes) {
    if (shape.type === "arrow" || shape.type === "group" || typeof shape.id !== "string") {
      continue;
    }
    let nodeId = canvasNodeIdForTldrawShapeRecord(shape);
    if (usedNodeIds.has(nodeId)) nodeId = safeCanvasId(undefined, shape.id);
    if (usedNodeIds.has(nodeId)) continue;
    usedNodeIds.add(nodeId);
    result.set(shape.id, nodeId);
  }
  return result;
}

function shapeText(shape: Record<string, unknown>): string {
  const props = isRecord(shape.props) ? shape.props : {};
  if (shape.type === "frame") return sanitizeText(props.name, 50_000);
  return richTextToPlainText(props.richText);
}

function shapeDimensions(shape: Record<string, unknown>): { width: number; height: number } {
  const props = isRecord(shape.props) ? shape.props : {};
  const scale = isFiniteNumber(props.scale) && props.scale > 0 ? Math.min(props.scale, 100) : 1;
  let width = isFiniteNumber(props.w) ? props.w : 180;
  let height = isFiniteNumber(props.h) ? props.h : 100;
  if (shape.type === "note") {
    width = 200;
    height = 200 + (isFiniteNumber(props.growY) ? Math.max(0, props.growY) : 0);
  } else if (shape.type === "text") {
    height = Math.max(40, Math.ceil(shapeText(shape).length / 30) * 28);
  } else if (shape.type === "draw" || shape.type === "highlight" || shape.type === "line") {
    const points: Array<{ x: number; y: number }> = [];
    if (shape.type === "line" && isRecord(props.points)) {
      for (const point of Object.values(props.points)) {
        if (isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y)) {
          points.push({ x: point.x, y: point.y });
        }
      }
    } else if (Array.isArray(props.segments)) {
      for (const segment of props.segments) {
        if (!isRecord(segment) || !Array.isArray(segment.points)) continue;
        for (const point of segment.points) {
          if (isRecord(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y)) {
            points.push({ x: point.x, y: point.y });
          }
        }
      }
    }
    if (points.length > 0) {
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      width = Math.max(1, Math.max(...xs) - Math.min(...xs));
      height = Math.max(1, Math.max(...ys) - Math.min(...ys));
    }
  }
  return {
    width: Math.min(100_000, Math.max(8, width * scale)),
    height: Math.min(100_000, Math.max(8, height * scale)),
  };
}

function sampledVectorPoints(
  points: readonly { x: number; y: number; z?: number }[],
  limit: number,
): Array<{ x: number; y: number; z?: number }> {
  if (points.length <= limit) return [...points];
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index * (points.length - 1)) / (limit - 1));
    return points[sourceIndex]!;
  });
}

/**
 * Produces the bounded, origin-normalized geometry that may be sent to the AI
 * model. Callers must pass a record from the authorized durable snapshot, not
 * a client-supplied shape, so vector selection cannot be spoofed.
 */
export function canvasSourceGeometryForTldrawShapeRecord(
  shape: Record<string, unknown>,
): CanvasSourceGeometry | undefined {
  if (shape.type !== "draw" && shape.type !== "highlight" && shape.type !== "line") {
    return undefined;
  }
  const props = isRecord(shape.props) ? shape.props : {};
  const rawSegments: Array<{
    type: "free" | "straight";
    points: Array<{ x: number; y: number; z?: number }>;
  }> = [];

  if (shape.type === "line" && isRecord(props.points)) {
    const points = Object.values(props.points)
      .filter(isRecord)
      .sort((left, right) => String(left.index ?? "").localeCompare(String(right.index ?? "")))
      .flatMap((point) =>
        isFiniteNumber(point.x) && isFiniteNumber(point.y)
          ? [{ x: point.x, y: point.y }]
          : [],
      );
    if (points.length > 0) rawSegments.push({ type: "straight", points });
  } else if (Array.isArray(props.segments)) {
    for (const segment of props.segments) {
      if (!isRecord(segment) || !Array.isArray(segment.points)) continue;
      const points = segment.points.flatMap((point) => {
        if (!isRecord(point) || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
          return [];
        }
        const z = isFiniteNumber(point.z)
          ? Math.min(1, Math.max(0, point.z))
          : undefined;
        return [{ x: point.x, y: point.y, ...(z === undefined ? {} : { z }) }];
      });
      if (points.length > 0) {
        rawSegments.push({
          type: segment.type === "free" ? "free" : "straight",
          points,
        });
      }
    }
  }
  if (rawSegments.length === 0) return undefined;

  const selectedSegments = rawSegments.length <= 32
    ? rawSegments
    : Array.from({ length: 32 }, (_, index) =>
        rawSegments[Math.round((index * (rawSegments.length - 1)) / 31)]!,
      );
  const pointsPerSegment = Math.max(2, Math.floor(96 / selectedSegments.length));
  const sampledSegments = selectedSegments.map((segment) => {
    const points = sampledVectorPoints(segment.points, Math.min(64, pointsPerSegment));
    if (points.length === 1) points.push({ ...points[0]! });
    return { type: segment.type, points };
  });
  const allPoints = sampledSegments.flatMap((segment) => segment.points);
  const minX = Math.min(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const scale = Math.min(1, 10_000 / Math.max(1, maxX - minX, maxY - minY));

  return {
    shapeType: shape.type,
    segments: sampledSegments.map((segment) => ({
      type: segment.type,
      points: segment.points.map((point) => ({
        x: Number(((point.x - minX) * scale).toFixed(3)),
        y: Number(((point.y - minY) * scale).toFixed(3)),
        ...(point.z === undefined ? {} : { z: Number(point.z.toFixed(3)) }),
      })),
    })),
  };
}

function tldrawColor(value: unknown, fallback = "#e0f2fe"): string {
  if (typeof value === "string" && /^(?:transparent|#[0-9a-fA-F]{3,8})$/.test(value)) {
    return value;
  }
  const colors: Record<string, string> = {
    black: "#111827",
    blue: "#0284c7",
    gray: "#64748b",
    grey: "#64748b",
    green: "#16a34a",
    "light-blue": "#e0f2fe",
    "light-green": "#dcfce7",
    "light-red": "#fee2e2",
    "light-violet": "#ede9fe",
    orange: "#f97316",
    red: "#dc2626",
    violet: "#7c3aed",
    white: "#ffffff",
    yellow: "#facc15",
  };
  return typeof value === "string" ? (colors[value] ?? fallback) : fallback;
}

function nodeTypeForShape(shape: Record<string, unknown>, fabric: Record<string, unknown>): NodeType {
  if (typeof fabric.nodeType === "string" && CANVAS_NODE_TYPES.has(fabric.nodeType as NodeType)) {
    return fabric.nodeType as NodeType;
  }
  if (shape.type === "frame") return "frame";
  if (shape.type === "note") return "note";
  if (shape.type === "text") return "text";
  if (shape.type === "image" || shape.type === "video" || shape.type === "bookmark") {
    return "image";
  }
  if (shape.type === "draw" || shape.type === "highlight" || shape.type === "line") {
    return "drawing";
  }
  if (shape.type === "geo") {
    const props = isRecord(shape.props) ? shape.props : {};
    if (props.geo === "ellipse") return "ellipse";
    if (props.geo === "diamond") return "diamond";
    if (props.geo === "triangle") return "triangle";
    if (props.geo === "hexagon") return "hexagon";
    return "rectangle";
  }
  return "summary";
}

type ShapeHierarchyProjection = Readonly<{
  x: number;
  y: number;
  effectivelyLocked: boolean;
  writeScopeSafe: boolean;
}>;

function shapeHierarchyProjection(
  shape: Record<string, unknown>,
  shapes: ReadonlyMap<string, Record<string, unknown>>,
): ShapeHierarchyProjection {
  let x = isFiniteNumber(shape.x) ? shape.x : 0;
  let y = isFiniteNumber(shape.y) ? shape.y : 0;
  let effectivelyLocked = shape.isLocked === true;
  let writeScopeSafe = isFiniteNumber(shape.rotation) && Math.abs(shape.rotation) <= 1e-9;
  let parentId = typeof shape.parentId === "string" ? shape.parentId : "";
  const seen = new Set<string>(typeof shape.id === "string" ? [shape.id] : []);
  while (parentId.startsWith("shape:") && !seen.has(parentId) && seen.size < 32) {
    seen.add(parentId);
    const parent = shapes.get(parentId);
    if (!parent) {
      writeScopeSafe = false;
      break;
    }
    x += isFiniteNumber(parent.x) ? parent.x : 0;
    y += isFiniteNumber(parent.y) ? parent.y : 0;
    effectivelyLocked ||= parent.isLocked === true;
    writeScopeSafe &&=
      isFiniteNumber(parent.rotation) && Math.abs(parent.rotation) <= 1e-9;
    parentId = typeof parent.parentId === "string" ? parent.parentId : "";
  }

  // A cycle, an ancestry chain beyond the audited bound, a missing shape
  // ancestor, or any non-page root makes the additive projection uncertain.
  // Those nodes remain useful read-only context, but must never enter the
  // visible-canvas mutation scope.
  if (parentId.startsWith("shape:") || !parentId.startsWith("page:")) {
    writeScopeSafe = false;
  }
  return {
    x: Math.min(10_000_000, Math.max(-10_000_000, x)),
    y: Math.min(10_000_000, Math.max(-10_000_000, y)),
    effectivelyLocked,
    writeScopeSafe,
  };
}

function descendantContainerShapeIds(
  shapes: ReadonlyMap<string, Record<string, unknown>>,
): ReadonlySet<string> {
  const containers = new Set<string>();
  for (const shape of shapes.values()) {
    let parentId = typeof shape.parentId === "string" ? shape.parentId : "";
    const seen = new Set<string>();
    while (parentId.startsWith("shape:") && !seen.has(parentId) && seen.size < 32) {
      seen.add(parentId);
      containers.add(parentId);
      const parent = shapes.get(parentId);
      if (!parent) break;
      parentId = typeof parent.parentId === "string" ? parent.parentId : "";
    }
  }
  return containers;
}

function splitTitleAndBody(text: string, fallbackTitle: string, fallbackBody: string): {
  title: string;
  body?: string;
} {
  const [firstLine = "", ...rest] = text.split("\n");
  const title = sanitizeText(firstLine || fallbackTitle || "Untitled", 500) || "Untitled";
  const body = sanitizeText(rest.join("\n").trim() || fallbackBody, 50_000);
  return body ? { title, body } : { title };
}

export function projectTldrawDocument(
  document: FabricTldrawDocument,
): TldrawCanvasProjection {
  const records = Object.values(document.snapshot.store);
  const shapeRecords = new Map<string, Record<string, unknown>>();
  for (const record of records) {
    if (record.typeName === "shape") shapeRecords.set(record.id, record);
  }

  const nodes: CanvasNode[] = [];
  const shapeToNodeId = projectedCanvasNodeIdMapForTldrawShapeRecords(
    [...shapeRecords.values()],
  );
  const containerShapeIds = descendantContainerShapeIds(shapeRecords);

  for (const shape of shapeRecords.values()) {
    const nodeId = shapeToNodeId.get(shape.id as string);
    if (!nodeId) continue;
    const fabric = readFabricMeta(shape);

    const props = isRecord(shape.props) ? shape.props : {};
    const text = shapeText(shape);
    const content = splitTitleAndBody(
      text,
      sanitizeText(fabric.title, 500) || String(shape.type ?? "Shape"),
      sanitizeText(fabric.body, 50_000),
    );
    const hierarchy = shapeHierarchyProjection(shape, shapeRecords);
    const dimensions = shapeDimensions(shape);
    const parentShapeId = typeof shape.parentId === "string" ? shape.parentId : undefined;
    const parentId = parentShapeId ? shapeToNodeId.get(parentShapeId) : undefined;
    const parentProjectionSafe =
      !parentShapeId?.startsWith("shape:") || parentId !== undefined;
    const fill = tldrawColor(fabric.fill ?? props.color);
    const textColor = tldrawColor(fabric.textColor ?? props.labelColor ?? props.color, "#111827");
    nodes.push({
      id: nodeId,
      type: nodeTypeForShape(shape, fabric),
      ...content,
      x: hierarchy.x,
      y: hierarchy.y,
      width: dimensions.width,
      height: dimensions.height,
      fill,
      textColor,
      locked: hierarchy.effectivelyLocked || undefined,
      viewportWriteSafe:
        hierarchy.writeScopeSafe && parentProjectionSafe ? undefined : false,
      hasDescendants: containerShapeIds.has(String(shape.id)) || undefined,
      parentId,
      tag: sanitizeText(fabric.tag, 120) || undefined,
      meta: sanitizeText(fabric.meta, 2_000) || `tldraw:${String(shape.type)}`,
    });
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const bindings = records.filter(
    (record) => record.typeName === "binding" && record.type === "arrow",
  );
  const bindingsByArrow = new Map<string, { start?: string; end?: string }>();
  for (const binding of bindings) {
    const props = isRecord(binding.props) ? binding.props : {};
    if (
      typeof binding.fromId !== "string" ||
      typeof binding.toId !== "string" ||
      (props.terminal !== "start" && props.terminal !== "end")
    ) {
      continue;
    }
    const entry = bindingsByArrow.get(binding.fromId) ?? {};
    entry[props.terminal] = binding.toId;
    bindingsByArrow.set(binding.fromId, entry);
  }

  const edges: CanvasEdge[] = [];
  const usedEdgeIds = new Set<string>();
  for (const arrow of shapeRecords.values()) {
    if (arrow.type !== "arrow") continue;
    const fabric = readFabricMeta(arrow);
    const bound = bindingsByArrow.get(arrow.id as string);
    const rawSource = fabric.sourceId ?? (bound?.start ? shapeToNodeId.get(bound.start) : undefined);
    const rawTarget = fabric.targetId ?? (bound?.end ? shapeToNodeId.get(bound.end) : undefined);
    const sourceId = safeCanvasId(rawSource, String(rawSource ?? "source"));
    const targetId = safeCanvasId(rawTarget, String(rawTarget ?? "target"));
    if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) continue;
    let id = safeCanvasId(fabric.edgeId, arrow.id as string);
    if (usedEdgeIds.has(id)) id = safeCanvasId(undefined, arrow.id as string);
    if (usedEdgeIds.has(id)) continue;
    usedEdgeIds.add(id);
    const props = isRecord(arrow.props) ? arrow.props : {};
    edges.push({
      id,
      sourceId,
      targetId,
      route: fabric.route === "elbow" || props.kind === "elbow" ? "elbow" : "straight",
    });
  }
  return { nodes, edges };
}

function plainRichText(text: string): JsonValue {
  const paragraphs = text.split("\n");
  return {
    type: "doc",
    content: paragraphs.map((paragraph) => ({
      type: "paragraph",
      ...(paragraph ? { content: [{ type: "text", text: paragraph }] } : {}),
    })),
  };
}

function stableShapeSuffix(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 72);
  let hash = 2_166_136_261;
  for (const character of id) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fabric-${safe || "shape"}-${(hash >>> 0).toString(36)}`;
}

export function tldrawShapeIdForCanvasNode(id: string): TLShapeId {
  return `shape:${stableShapeSuffix(id)}` as TLShapeId;
}

function fabricNodeMeta(node: CanvasNode): Record<string, JsonValue> {
  return {
    kind: "node",
    nodeId: node.id,
    nodeType: node.type,
    title: node.title,
    ...(node.body ? { body: node.body } : {}),
    fill: node.fill,
    ...(node.textColor ? { textColor: node.textColor } : {}),
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.tag ? { tag: node.tag } : {}),
    ...(node.meta ? { meta: node.meta } : {}),
  };
}

export function legacyCanvasToTldrawShapeInputs(
  canvas: TldrawCanvasProjection,
): TLShapePartial[] {
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const shapeIds = new Map(
    canvas.nodes.map((node) => [node.id, tldrawShapeIdForCanvasNode(node.id)]),
  );
  const orderedNodes = [...canvas.nodes].sort((left, right) => {
    if (left.type === "frame" && right.type !== "frame") return -1;
    if (right.type === "frame" && left.type !== "frame") return 1;
    return 0;
  });
  const shapes: TLShapePartial[] = orderedNodes.map((node) => {
    const id = shapeIds.get(node.id) as TLShapeId;
    const text = [node.title, node.body].filter(Boolean).join("\n\n");
    const parentId = node.parentId ? shapeIds.get(node.parentId) : undefined;
    const base = {
      id,
      x: node.x,
      y: node.y,
      isLocked: Boolean(node.locked),
      ...(parentId && nodeById.has(node.parentId ?? "") ? { parentId } : {}),
      meta: { fabric: fabricNodeMeta(node) },
    };
    if (node.type === "frame") {
      return {
        ...base,
        type: "frame",
        props: { w: node.width, h: node.height, name: node.title, color: "blue" },
      } as TLShapePartial;
    }
    if (node.type === "note") {
      return {
        ...base,
        type: "note",
        props: { color: "light-blue", labelColor: "black", richText: plainRichText(text) },
      } as TLShapePartial;
    }
    if (node.type === "text") {
      return {
        ...base,
        type: "text",
        props: {
          color: "blue",
          w: node.width,
          autoSize: false,
          richText: plainRichText(text),
        },
      } as TLShapePartial;
    }
    return {
      ...base,
      type: "geo",
      props: {
        geo: node.type === "ellipse" ? "ellipse" : "rectangle",
        w: node.width,
        h: node.height,
        color: "blue",
        labelColor: "black",
        fill: "semi",
        richText: plainRichText(text),
      },
    } as TLShapePartial;
  });

  for (const edge of canvas.edges) {
    const source = nodeById.get(edge.sourceId);
    const target = nodeById.get(edge.targetId);
    if (!source || !target) continue;
    const start = {
      x: source.x + source.width / 2,
      y: source.y + source.height / 2,
    };
    const end = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };
    shapes.push({
      id: `shape:${stableShapeSuffix(edge.id)}` as TLShapeId,
      type: "arrow",
      x: start.x,
      y: start.y,
      props: {
        kind: edge.route === "elbow" ? "elbow" : "arc",
        color: "blue",
        start: { x: 0, y: 0 },
        end: { x: end.x - start.x, y: end.y - start.y },
      },
      meta: {
        fabric: {
          kind: "edge",
          edgeId: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          route: edge.route,
        },
      },
    } as TLShapePartial);
  }
  return shapes;
}
