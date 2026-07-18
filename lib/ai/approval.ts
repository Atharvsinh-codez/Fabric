import { z } from "zod";

import type { CanvasPatch } from "./canvas-patch";
import {
  normalizePenDrawing,
  PEN_RENDERER_VERSION,
  renderPenText,
  type PenSegment,
} from "./pen-renderer";
import type { CanvasDocumentSnapshot } from "../boards/canvas-document";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const AiProposalApprovalRequestSchema = z
  .object({
    runId: z.string().uuid(),
    patchHash: Sha256Schema,
    documentGenerationId: z.string().uuid(),
    baseDurableSequence: z.number().int().nonnegative().safe(),
    observedDurableSequence: z.number().int().nonnegative().safe(),
  })
  .strict();

export type AiProposalApprovalRequest = z.infer<
  typeof AiProposalApprovalRequestSchema
>;

export const AiProposalApprovalResultSchema = z
  .object({
    run: z
      .object({
        id: z.string().uuid(),
        status: z.literal("completed"),
        boardId: z.string().uuid(),
        documentGenerationId: z.string().uuid(),
        baseDurableSequence: z.number().int().nonnegative().safe(),
        appliedDurableSequence: z.number().int().nonnegative().safe(),
        finalizedAt: z.string().datetime(),
      })
      .strict(),
  })
  .strict();

export type AiProposalApprovalResult = z.infer<
  typeof AiProposalApprovalResultSchema
>;

export type ApprovalProjectionIssueCode =
  | "missing_created_node"
  | "created_node_mismatch"
  | "missing_target_node"
  | "updated_node_mismatch"
  | "moved_node_mismatch"
  | "resized_node_mismatch"
  | "node_not_deleted"
  | "missing_connector"
  | "connector_mismatch"
  | "missing_native_drawing"
  | "native_drawing_mismatch";

export type ApprovalProjectionVerification =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; issueCodes: readonly ApprovalProjectionIssueCode[] }>;

const FILL_VALUES: Record<string, ReadonlySet<string>> = {
  surface: new Set(["#ffffff"]),
  ink: new Set(["#111827", "#1e2430"]),
  sky: new Set(["#0284c7", "#dce8ff"]),
  mint: new Set(["#16a34a", "#d9f1e6"]),
  butter: new Set(["#facc15", "#ffedb7"]),
  lavender: new Set(["#7c3aed", "#f0ddff"]),
  rose: new Set(["#dc2626", "#ffe1df"]),
  fog: new Set(["#64748b", "#eef3f8"]),
};

const TEXT_VALUES: Record<string, ReadonlySet<string>> = {
  ink: new Set(["#111827", "#22231f"]),
  surface: new Set(["#ffffff"]),
  muted: new Set(["#64748b", "#7a7d85"]),
};

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.05;
}

function resolvedId(id: string | undefined | null): string | undefined {
  return id === null || id === undefined ? undefined : id;
}

function normalizeOptionalText(value: string | undefined | null): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : value;
}

function normalizeProjectedBody(value: string | undefined | null): string | undefined {
  const normalized = normalizeOptionalText(value);
  if (normalized === undefined) return undefined;
  // tldraw rich text canonicalizes consecutive paragraph separators when a
  // string is converted to editable content and projected back to the board.
  // Blank-line count is presentation-only; every visible character must still
  // match the approved proposal exactly.
  return normalized.replace(/\r\n?/g, "\n").replace(/\n+/g, "\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function penSegments(value: unknown): PenSegment[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const segments: PenSegment[] = [];
  for (const valueSegment of value) {
    if (
      !isRecord(valueSegment) ||
      (valueSegment.type !== "free" && valueSegment.type !== "straight") ||
      !Array.isArray(valueSegment.points) ||
      valueSegment.points.length < 2
    ) {
      return null;
    }
    const points: Array<{ x: number; y: number; z?: number }> = [];
    for (const valuePoint of valueSegment.points) {
      if (
        !isRecord(valuePoint) ||
        typeof valuePoint.x !== "number" ||
        !Number.isFinite(valuePoint.x) ||
        typeof valuePoint.y !== "number" ||
        !Number.isFinite(valuePoint.y) ||
        (valuePoint.z !== undefined &&
          (typeof valuePoint.z !== "number" || !Number.isFinite(valuePoint.z)))
      ) {
        return null;
      }
      points.push({
        x: valuePoint.x,
        y: valuePoint.y,
        ...(typeof valuePoint.z === "number" ? { z: valuePoint.z } : {}),
      });
    }
    segments.push({ type: valueSegment.type, points });
  }
  return segments;
}

const NATIVE_DRAW_COLORS: Record<string, string> = {
  surface: "white",
  ink: "black",
  sky: "blue",
  mint: "green",
  butter: "yellow",
  lavender: "violet",
  rose: "red",
  fog: "grey",
};

function nativeDrawingMatches(
  operation: Extract<CanvasPatch["operations"][number], { type: "writeText" | "createDrawing" }>,
  document: CanvasDocumentSnapshot,
): "missing" | "mismatch" | "match" {
  const shapes = Object.values(document.tldraw?.snapshot.store ?? {}).filter((record) => {
    if (record.typeName !== "shape" || !isRecord(record.meta)) return false;
    const fabric = isRecord(record.meta.fabric) ? record.meta.fabric : null;
    return fabric?.nodeId === operation.tempId;
  });
  if (shapes.length === 0) return "missing";
  if (shapes.length !== 1) return "mismatch";

  const shape = shapes[0]!;
  if (shape.type !== "draw" || !isRecord(shape.props) || !isRecord(shape.meta)) {
    return "mismatch";
  }
  const fabric = isRecord(shape.meta.fabric) ? shape.meta.fabric : null;
  const actualSegments = penSegments(shape.props.segments);
  if (!fabric || !actualSegments) return "mismatch";

  const expected = operation.type === "writeText"
    ? renderPenText({
        text: operation.text,
        fontSize: operation.fontSize,
        maxWidth: operation.maxWidth,
      })
    : normalizePenDrawing(operation.segments);
  const actual = normalizePenDrawing(actualSegments);
  const expectedColor = NATIVE_DRAW_COLORS[operation.color ?? "ink"];
  const metadataMatches = operation.type === "writeText"
    ? fabric.penText === operation.text &&
      fabric.penFontSize === operation.fontSize &&
      fabric.penMaxWidth === operation.maxWidth &&
      fabric.penRenderer === PEN_RENDERER_VERSION &&
      fabric.drawingFingerprint === expected.fingerprint
    : fabric.drawingSource === "canvas-agent" &&
      fabric.drawingFingerprint === expected.fingerprint;

  return shape.props.color === expectedColor &&
    shape.props.fill === "none" &&
    shape.props.isPen === true &&
    shape.props.isComplete === true &&
    shape.props.isClosed === false &&
    (operation.type !== "createDrawing" || shape.props.size === (operation.size ?? "m")) &&
    JSON.stringify(actual.segments) === JSON.stringify(expected.segments) &&
    metadataMatches
    ? "match"
    : "mismatch";
}

function appearanceMatches(
  node: CanvasDocumentSnapshot["nodes"][number],
  appearance: { fill?: string; textColor?: string } | undefined,
): boolean {
  if (!appearance) return true;
  if (appearance.fill && !FILL_VALUES[appearance.fill]?.has(node.fill.toLowerCase())) {
    return false;
  }
  if (
    appearance.textColor &&
    (!node.textColor ||
      !TEXT_VALUES[appearance.textColor]?.has(node.textColor.toLowerCase()))
  ) {
    return false;
  }
  return true;
}

/**
 * Verifies only the persisted semantic projection. A tldraw implementation must
 * preserve proposal temporary ids in Fabric metadata so created nodes and
 * connectors remain auditably identifiable after serialization.
 */
export function verifyApprovedPatchProjection(
  patch: CanvasPatch,
  document: CanvasDocumentSnapshot,
): ApprovalProjectionVerification {
  const nodes = new Map(document.nodes.map((node) => [node.id, node]));
  const edges = new Map(document.edges.map((edge) => [edge.id, edge]));
  const issues = new Set<ApprovalProjectionIssueCode>();

  for (const operation of patch.operations) {
    if (operation.type === "createNode") {
      const node = nodes.get(operation.tempId);
      if (!node) {
        issues.add("missing_created_node");
        continue;
      }
      const matches =
        node.type === operation.nodeType &&
        node.title === operation.content.title &&
        normalizeProjectedBody(node.body) === normalizeProjectedBody(operation.content.body) &&
        (node.tag ?? undefined) === (operation.content.tag ?? undefined) &&
        (operation.content.meta === undefined || node.meta === operation.content.meta) &&
        sameNumber(node.x, operation.position.x) &&
        sameNumber(node.y, operation.position.y) &&
        sameNumber(node.width, operation.size.width) &&
        sameNumber(node.height, operation.size.height) &&
        resolvedId(node.parentId) === resolvedId(operation.parentId) &&
        appearanceMatches(node, operation.appearance);
      if (!matches) issues.add("created_node_mismatch");
      continue;
    }

    if (operation.type === "writeText" || operation.type === "createDrawing") {
      const node = nodes.get(operation.tempId);
      if (!node) {
        issues.add("missing_created_node");
        continue;
      }
      const drawing = operation.type === "writeText"
        ? renderPenText({
            text: operation.text,
            fontSize: operation.fontSize,
            maxWidth: operation.maxWidth,
          })
        : normalizePenDrawing(operation.segments);
      const matches =
        node.type === "drawing" &&
        sameNumber(node.x, operation.position.x) &&
        sameNumber(node.y, operation.position.y) &&
        sameNumber(node.width, Math.max(8, drawing.width)) &&
        sameNumber(node.height, Math.max(8, drawing.height)) &&
        resolvedId(node.parentId) === resolvedId(operation.parentId) &&
        (operation.type !== "writeText" ||
          (node.title ===
            (operation.text.split(/\r?\n/, 1)[0]?.slice(0, 200) || "Pen text") &&
            node.body === operation.text));
      if (!matches) issues.add("created_node_mismatch");
      const nativeMatch = nativeDrawingMatches(operation, document);
      if (nativeMatch === "missing") issues.add("missing_native_drawing");
      else if (nativeMatch === "mismatch") issues.add("native_drawing_mismatch");
      continue;
    }

    if (operation.type === "createConnector") {
      const edge = edges.get(operation.tempId);
      if (!edge) {
        issues.add("missing_connector");
        continue;
      }
      if (
        edge.sourceId !== operation.sourceId ||
        edge.targetId !== operation.targetId ||
        edge.route !== operation.route
      ) {
        issues.add("connector_mismatch");
      }
      continue;
    }

    const node = nodes.get(operation.nodeId);
    if (operation.type === "deleteNode") {
      if (node) issues.add("node_not_deleted");
      continue;
    }
    if (!node) {
      issues.add("missing_target_node");
      continue;
    }

    if (operation.type === "moveNode") {
      const positionMatches =
        sameNumber(node.x, operation.position.x) &&
        sameNumber(node.y, operation.position.y);
      const parentMatches =
        operation.parentId === undefined ||
        resolvedId(node.parentId) === resolvedId(operation.parentId);
      if (!positionMatches || !parentMatches) issues.add("moved_node_mismatch");
    } else if (operation.type === "resizeNode") {
      if (
        !sameNumber(node.width, operation.size.width) ||
        !sameNumber(node.height, operation.size.height)
      ) {
        issues.add("resized_node_mismatch");
      }
    } else if (operation.type === "updateNode") {
      const content = operation.content;
      const matches =
        (!content?.title || node.title === content.title) &&
        (content?.body === undefined ||
          normalizeProjectedBody(node.body) === normalizeProjectedBody(content.body)) &&
        (content?.tag === undefined || (node.tag ?? undefined) === content.tag) &&
        (content?.meta === undefined || (node.meta ?? undefined) === content.meta) &&
        appearanceMatches(node, operation.appearance);
      if (!matches) issues.add("updated_node_mismatch");
    }
  }

  return issues.size === 0
    ? { ok: true }
    : { ok: false, issueCodes: [...issues].sort() };
}
