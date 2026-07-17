import "server-only";

import sharp from "sharp";

import type { BoardDocument } from "@/db/schema/product";
import { readAuthoritativeCanvasDocument } from "@/lib/boards/canvas-document";
import {
  canvasSourceGeometryForTldrawShapeRecord,
  projectedCanvasNodeIdMapForTldrawShapeRecords,
} from "@/lib/boards/tldraw-document";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

export const BOARD_THUMBNAIL_WIDTH = 640;
export const BOARD_THUMBNAIL_HEIGHT = 400;

const MAX_RENDERED_NODES = 240;
const MAX_RENDERED_EDGES = 320;
const MAX_RENDERED_DRAWINGS = 64;
const MAX_LABEL_CHARACTERS = 96;
const MAX_COORDINATE = 10_000_000;
const MAX_NODE_SIZE = 100_000;

type Point = Readonly<{ x: number; y: number }>;
type DrawingPath = Readonly<{
  points: readonly Point[];
  highlight: boolean;
}>;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value)
    ? Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, value))
    : fallback;
}

function positiveSize(value: number): number {
  return Number.isFinite(value)
    ? Math.min(MAX_NODE_SIZE, Math.max(1, value))
    : 1;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeLabel(value: string): string {
  return escapeXml(
    Array.from(value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim())
      .slice(0, MAX_LABEL_CHARACTERS)
      .join(""),
  );
}

function safeColor(value: string | undefined, fallback: string): string {
  if (value === "transparent") return "transparent";
  return value && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value)
    ? value
    : fallback;
}

function mapCoordinate(value: number, min: number, max: number, size: number): number {
  return max > min ? ((value - min) / (max - min)) * size : size / 2;
}

function pathData(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
    .join(" ");
}

function drawingPaths(
  document: ReturnType<typeof readAuthoritativeCanvasDocument>,
): ReadonlyMap<string, readonly DrawingPath[]> {
  if (!document.tldraw) return new Map();
  const shapeRecords = Object.values(document.tldraw.snapshot.store).filter(
    (record): record is typeof record & Record<string, unknown> =>
      record.typeName === "shape",
  );
  const shapeToNodeId = projectedCanvasNodeIdMapForTldrawShapeRecords(shapeRecords);
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const result = new Map<string, DrawingPath[]>();
  let renderedDrawings = 0;

  for (const shape of shapeRecords) {
    if (renderedDrawings >= MAX_RENDERED_DRAWINGS || typeof shape.id !== "string") break;
    const nodeId = shapeToNodeId.get(shape.id);
    const node = nodeId ? nodeById.get(nodeId) : undefined;
    const source = canvasSourceGeometryForTldrawShapeRecord(shape);
    if (!nodeId || !node || !source) continue;

    const sourcePoints = source.segments.flatMap((segment) => segment.points);
    if (sourcePoints.length === 0) continue;
    const minX = Math.min(...sourcePoints.map((point) => point.x));
    const minY = Math.min(...sourcePoints.map((point) => point.y));
    const maxX = Math.max(...sourcePoints.map((point) => point.x));
    const maxY = Math.max(...sourcePoints.map((point) => point.y));
    const nodeX = finite(node.x);
    const nodeY = finite(node.y);
    const nodeWidth = positiveSize(node.width);
    const nodeHeight = positiveSize(node.height);
    const paths = source.segments.flatMap((segment) => {
      const points = segment.points.map((point) => ({
        x: nodeX + mapCoordinate(point.x, minX, maxX, nodeWidth),
        y: nodeY + mapCoordinate(point.y, minY, maxY, nodeHeight),
      }));
      return points.length > 0
        ? [{ points, highlight: source.shapeType === "highlight" }]
        : [];
    });
    if (paths.length > 0) {
      result.set(nodeId, paths);
      renderedDrawings += 1;
    }
  }

  return result;
}

function fittedViewBox(nodes: readonly CanvasNode[]): string {
  if (nodes.length === 0) {
    return `0 0 ${BOARD_THUMBNAIL_WIDTH} ${BOARD_THUMBNAIL_HEIGHT}`;
  }
  const minX = Math.min(...nodes.map((node) => finite(node.x)));
  const minY = Math.min(...nodes.map((node) => finite(node.y)));
  const maxX = Math.max(
    ...nodes.map((node) => finite(node.x) + positiveSize(node.width)),
  );
  const maxY = Math.max(
    ...nodes.map((node) => finite(node.y) + positiveSize(node.height)),
  );
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = Math.max(20, Math.min(240, Math.max(contentWidth, contentHeight) * 0.08));
  let x = minX - padding;
  let y = minY - padding;
  let width = contentWidth + padding * 2;
  let height = contentHeight + padding * 2;
  const targetRatio = BOARD_THUMBNAIL_WIDTH / BOARD_THUMBNAIL_HEIGHT;
  if (width / height > targetRatio) {
    const nextHeight = width / targetRatio;
    y -= (nextHeight - height) / 2;
    height = nextHeight;
  } else {
    const nextWidth = height * targetRatio;
    x -= (nextWidth - width) / 2;
    width = nextWidth;
  }
  return `${round(x)} ${round(y)} ${round(width)} ${round(height)}`;
}

function nodeShape(node: CanvasNode, scaleStroke: number): string {
  const x = finite(node.x);
  const y = finite(node.y);
  const width = positiveSize(node.width);
  const height = positiveSize(node.height);
  const fill = safeColor(node.fill, "#f1f5f9");
  const stroke = "#8b98a8";
  const strokeWidth = round(scaleStroke);

  if (node.type === "ellipse") {
    return `<ellipse cx="${round(x + width / 2)}" cy="${round(y + height / 2)}" rx="${round(width / 2)}" ry="${round(height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (node.type === "diamond") {
    return `<polygon points="${round(x + width / 2)},${round(y)} ${round(x + width)},${round(y + height / 2)} ${round(x + width / 2)},${round(y + height)} ${round(x)},${round(y + height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (node.type === "triangle") {
    return `<polygon points="${round(x + width / 2)},${round(y)} ${round(x + width)},${round(y + height)} ${round(x)},${round(y + height)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (node.type === "hexagon") {
    return `<polygon points="${round(x + width * 0.25)},${round(y)} ${round(x + width * 0.75)},${round(y)} ${round(x + width)},${round(y + height / 2)} ${round(x + width * 0.75)},${round(y + height)} ${round(x + width * 0.25)},${round(y + height)} ${round(x)},${round(y + height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  }
  if (node.type === "text") return "";
  const frame = node.type === "frame";
  return `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${round(Math.min(frame ? 8 : 14, width / 6, height / 6))}" fill="${frame ? "none" : fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${frame ? ' stroke-dasharray="8 6"' : ""}/>`;
}

function nodeLabel(node: CanvasNode, viewWidth: number): string {
  const label = safeLabel(node.title);
  if (!label || node.type === "drawing") return "";
  const x = finite(node.x);
  const y = finite(node.y);
  const width = positiveSize(node.width);
  const height = positiveSize(node.height);
  const fontSize = Math.max(viewWidth / 180, Math.min(viewWidth / 34, height / 5, width / 10));
  const textColor = safeColor(node.textColor, "#111827");
  return `<text x="${round(x + Math.min(width * 0.08, 14))}" y="${round(y + Math.min(height * 0.42, fontSize * 1.4 + 8))}" font-family="Arial, sans-serif" font-size="${round(fontSize)}" font-weight="500" fill="${textColor}">${label}</text>`;
}

function edgeSvg(
  edge: CanvasEdge,
  nodeById: ReadonlyMap<string, CanvasNode>,
  strokeWidth: number,
): string {
  const source = nodeById.get(edge.sourceId);
  const target = nodeById.get(edge.targetId);
  if (!source || !target) return "";
  const sourceX = finite(source.x) + positiveSize(source.width) / 2;
  const sourceY = finite(source.y) + positiveSize(source.height) / 2;
  const targetX = finite(target.x) + positiveSize(target.width) / 2;
  const targetY = finite(target.y) + positiveSize(target.height) / 2;
  const path = edge.route === "elbow"
    ? `M${round(sourceX)} ${round(sourceY)} L${round(sourceX)} ${round(targetY)} L${round(targetX)} ${round(targetY)}`
    : `M${round(sourceX)} ${round(sourceY)} L${round(targetX)} ${round(targetY)}`;
  return `<path d="${path}" fill="none" stroke="#667588" stroke-width="${round(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#fabric-thumbnail-arrow)"/>`;
}

/** Builds a bounded internal SVG. It is rasterized before leaving the server. */
export function buildBoardThumbnailSvg(document: BoardDocument): string {
  const canvas = readAuthoritativeCanvasDocument(document);
  const nodes = canvas.nodes.slice(0, MAX_RENDERED_NODES);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const drawings = drawingPaths(canvas);
  const viewBox = fittedViewBox(nodes);
  const [
    rawViewX = "0",
    rawViewY = "0",
    rawViewWidth = String(BOARD_THUMBNAIL_WIDTH),
    rawViewHeight = String(BOARD_THUMBNAIL_HEIGHT),
  ] = viewBox.split(" ");
  const viewWidth = Math.max(1, Number(rawViewWidth));
  const gridSize = Math.max(16, viewWidth / 28);
  const gridStrokeWidth = Math.max(1, viewWidth / 1_280);
  const strokeWidth = Math.max(1, viewWidth / 420);
  const edges = canvas.edges
    .slice(0, MAX_RENDERED_EDGES)
    .map((edge) => edgeSvg(edge, nodeById, strokeWidth))
    .join("");
  const shapes = nodes.map((node) => {
    const paths = drawings.get(node.id);
    if (paths?.length) {
      return paths
        .map((path) => `<path d="${pathData(path.points)}" fill="none" stroke="${path.highlight ? "#eab308" : "#1f2937"}" stroke-opacity="${path.highlight ? "0.5" : "0.9"}" stroke-width="${round(path.highlight ? strokeWidth * 4 : strokeWidth * 1.4)}" stroke-linecap="round" stroke-linejoin="round"/>`)
        .join("");
    }
    return `${nodeShape(node, strokeWidth)}${nodeLabel(node, viewWidth)}`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_THUMBNAIL_WIDTH}" height="${BOARD_THUMBNAIL_HEIGHT}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet"><defs><pattern id="fabric-thumbnail-grid" width="${round(gridSize)}" height="${round(gridSize)}" patternUnits="userSpaceOnUse"><path d="M${round(gridSize)} 0H0V${round(gridSize)}" fill="none" stroke="#e6edf3" stroke-width="${round(gridStrokeWidth)}"/></pattern><marker id="fabric-thumbnail-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#667588"/></marker></defs><rect x="${rawViewX}" y="${rawViewY}" width="${rawViewWidth}" height="${rawViewHeight}" fill="#fbfdff"/><rect x="${rawViewX}" y="${rawViewY}" width="${rawViewWidth}" height="${rawViewHeight}" fill="url(#fabric-thumbnail-grid)"/>${edges}${shapes}</svg>`;
}

export async function renderBoardThumbnail(document: BoardDocument): Promise<Uint8Array> {
  const svg = Buffer.from(buildBoardThumbnailSvg(document), "utf8");
  return sharp(svg, {
    density: 72,
    limitInputPixels: BOARD_THUMBNAIL_WIDTH * BOARD_THUMBNAIL_HEIGHT,
  })
    .resize(BOARD_THUMBNAIL_WIDTH, BOARD_THUMBNAIL_HEIGHT, {
      fit: "fill",
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
