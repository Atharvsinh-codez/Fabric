import "server-only";

import sharp from "sharp";

import {
  AuthorizedBoardSceneSchema,
  type AuthorizedBoardScene,
} from "@/lib/ai/engine/authorized-scene";
import {
  ProposalNodeSnapshotSchema,
  type AiProposalRequest,
} from "@/lib/ai/proposal-request";

export const AI_SELECTION_PREVIEW_MAX_DIMENSION = 1_024;
const AI_SELECTION_PREVIEW_MIN_DIMENSION = 64;
const AI_SELECTION_PREVIEW_MAX_POINTS = 4_096;

type Selection = AiProposalRequest["selection"];
type Point = Readonly<{ x: number; y: number }>;
type RenderPath = Readonly<{
  points: readonly Point[];
  highlight: boolean;
}>;

function round(value: number): number {
  return Number(value.toFixed(3));
}

function mapCoordinate(value: number, min: number, max: number, size: number): number {
  return max > min ? ((value - min) / (max - min)) * size : size / 2;
}

function renderPaths(selection: Selection): RenderPath[] {
  const paths: RenderPath[] = [];
  for (const node of selection) {
    if (node.type !== "drawing" || !node.source) continue;
    const sourcePoints = node.source.segments.flatMap((segment) => segment.points);
    const minX = Math.min(...sourcePoints.map((point) => point.x));
    const minY = Math.min(...sourcePoints.map((point) => point.y));
    const maxX = Math.max(...sourcePoints.map((point) => point.x));
    const maxY = Math.max(...sourcePoints.map((point) => point.y));

    for (const segment of node.source.segments) {
      paths.push({
        highlight: node.source.shapeType === "highlight",
        points: segment.points.map((point) => ({
          x: round(node.x + mapCoordinate(point.x, minX, maxX, node.width)),
          y: round(node.y + mapCoordinate(point.y, minY, maxY, node.height)),
        })),
      });
    }
  }
  return paths;
}

function outputDimensions(width: number, height: number): { width: number; height: number } {
  const scale = AI_SELECTION_PREVIEW_MAX_DIMENSION / Math.max(width, height);
  return {
    width: Math.min(
      AI_SELECTION_PREVIEW_MAX_DIMENSION,
      Math.max(AI_SELECTION_PREVIEW_MIN_DIMENSION, Math.ceil(width * scale)),
    ),
    height: Math.min(
      AI_SELECTION_PREVIEW_MAX_DIMENSION,
      Math.max(AI_SELECTION_PREVIEW_MIN_DIMENSION, Math.ceil(height * scale)),
    ),
  };
}

function pathData(points: readonly Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
    .join(" ");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sceneColor(fill: string): string {
  const normalized = fill.toLowerCase();
  if (normalized.includes("yellow") || normalized.includes("butter") || normalized === "#ffedb7") return "#fff2b8";
  if (normalized.includes("green") || normalized.includes("mint") || normalized === "#d9f1e6") return "#dff4e7";
  if (normalized.includes("blue") || normalized.includes("sky") || normalized === "#dce8ff") return "#deebff";
  if (normalized.includes("violet") || normalized.includes("purple") || normalized.includes("lavender")) return "#eee2ff";
  if (normalized.includes("red") || normalized.includes("rose")) return "#ffe4e1";
  return "#f4f6f8";
}

function sceneDrawingPaths(scene: AuthorizedBoardScene): RenderPath[] {
  const paths: RenderPath[] = [];
  for (const node of scene.nodes) {
    if (node.type !== "drawing" || !node.source) continue;
    const sourcePoints = node.source.segments.flatMap((segment) => segment.points);
    const minX = Math.min(...sourcePoints.map((point) => point.x));
    const minY = Math.min(...sourcePoints.map((point) => point.y));
    const maxX = Math.max(...sourcePoints.map((point) => point.x));
    const maxY = Math.max(...sourcePoints.map((point) => point.y));
    for (const segment of node.source.segments) {
      paths.push({
        highlight: node.source.shapeType === "highlight",
        points: segment.points.map((point) => ({
          x: round(node.bounds.x + mapCoordinate(point.x, minX, maxX, node.bounds.width)),
          y: round(node.bounds.y + mapCoordinate(point.y, minY, maxY, node.bounds.height)),
        })),
      });
    }
  }
  return paths;
}

function sceneNodeSvg(node: AuthorizedBoardScene["nodes"][number]): string {
  const { x, y, width, height } = node.bounds;
  const stroke = node.role === "selected" ? "#0284c7" : "#64748b";
  const strokeWidth = node.role === "selected" ? 3 : 1.5;
  const fill = node.type === "frame" ? "none" : sceneColor(node.fill);
  let shape: string;
  if (node.type === "ellipse") {
    shape = `<ellipse cx="${round(x + width / 2)}" cy="${round(y + height / 2)}" rx="${round(width / 2)}" ry="${round(height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  } else if (node.type === "diamond") {
    shape = `<polygon points="${round(x + width / 2)},${round(y)} ${round(x + width)},${round(y + height / 2)} ${round(x + width / 2)},${round(y + height)} ${round(x)},${round(y + height / 2)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  } else if (node.type === "triangle") {
    shape = `<polygon points="${round(x + width / 2)},${round(y)} ${round(x + width)},${round(y + height)} ${round(x)},${round(y + height)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
  } else {
    shape = `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" rx="${node.type === "frame" ? 8 : 14}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"${node.type === "frame" ? ' stroke-dasharray="10 7"' : ""}/>`;
  }
  const label = escapeXml(node.title.replace(/\s+/gu, " ").slice(0, 80));
  const handle = escapeXml(node.handle);
  const fontSize = Math.max(12, Math.min(24, height / 5));
  return `${shape}<text x="${round(x + 10)}" y="${round(y + Math.min(28, height / 2))}" font-family="Arial, sans-serif" font-size="${round(fontSize)}" fill="#111827">${label}</text><text x="${round(x + 10)}" y="${round(y + height - 9)}" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="${stroke}">${handle}</text>`;
}

/**
 * Renders the server-authorized semantic scene so the model can understand
 * spatial composition, labels, frames, arrows, and selected drawings. Private
 * image pixels remain separate run-bound media inputs.
 */
export async function renderAiScenePreview(scene: unknown): Promise<Uint8Array> {
  const parsed = AuthorizedBoardSceneSchema.safeParse(scene);
  if (!parsed.success || parsed.data.nodes.length === 0) {
    throw new Error("AI scene preview input is invalid or empty.");
  }
  const bounds = parsed.data.nodes.map((node) => node.bounds);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = Math.max(16, Math.min(96, Math.max(contentWidth, contentHeight) * 0.04));
  const viewWidth = contentWidth + padding * 2;
  const viewHeight = contentHeight + padding * 2;
  const output = outputDimensions(viewWidth, viewHeight);
  const byHandle = new Map(parsed.data.nodes.map((node) => [node.handle, node]));
  const edgeSvg = parsed.data.edges.map((edge) => {
    const source = byHandle.get(edge.sourceHandle)!;
    const target = byHandle.get(edge.targetHandle)!;
    return `<path d="M${round(source.bounds.x + source.bounds.width / 2)} ${round(source.bounds.y + source.bounds.height / 2)} L${round(target.bounds.x + target.bounds.width / 2)} ${round(target.bounds.y + target.bounds.height / 2)}" fill="none" stroke="#64748b" stroke-width="2" marker-end="url(#arrow)"/>`;
  }).join("");
  const drawingSvg = sceneDrawingPaths(parsed.data).map((path) =>
    `<path d="${pathData(path.points)}" fill="none" stroke="${path.highlight ? "#f6c344" : "#111827"}" stroke-opacity="${path.highlight ? "0.55" : "1"}" stroke-width="${path.highlight ? 7 : 2.5}" stroke-linecap="round" stroke-linejoin="round"/>`,
  ).join("");
  const nodeSvg = parsed.data.nodes
    .filter((node) => node.type !== "drawing" || !node.source)
    .map(sceneNodeSvg)
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${output.height}" viewBox="${round(minX - padding)} ${round(minY - padding)} ${round(viewWidth)} ${round(viewHeight)}" preserveAspectRatio="xMidYMid meet"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#64748b"/></marker></defs><rect x="${round(minX - padding)}" y="${round(minY - padding)}" width="${round(viewWidth)}" height="${round(viewHeight)}" fill="#ffffff"/>${edgeSvg}${nodeSvg}${drawingSvg}</svg>`,
    "utf8",
  );
  return sharp(svg, { limitInputPixels: AI_SELECTION_PREVIEW_MAX_DIMENSION ** 2 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

/**
 * Renders only the already-authorized, bounded drawing geometry persisted in
 * an AI run. Text and other user-controlled fields never enter the SVG.
 */
export async function renderAiSelectionPreview(selection: unknown): Promise<Uint8Array> {
  const parsed = ProposalNodeSnapshotSchema.array().max(40).safeParse(selection);
  if (!parsed.success) throw new Error("AI selection preview input is invalid.");
  const pointCount = parsed.data.reduce(
    (total, node) =>
      total +
      (node.source?.segments.reduce(
        (segmentTotal, segment) => segmentTotal + segment.points.length,
        0,
      ) ?? 0),
    0,
  );
  if (pointCount === 0 || pointCount > AI_SELECTION_PREVIEW_MAX_POINTS) {
    throw new Error("AI selection preview has no renderable drawing geometry.");
  }

  const paths = renderPaths(parsed.data);
  const points = paths.flatMap((path) => path.points);
  if (points.length === 0) {
    throw new Error("AI selection preview has no renderable drawing geometry.");
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = Math.max(8, Math.min(80, Math.max(contentWidth, contentHeight) * 0.04));
  const viewWidth = contentWidth + padding * 2;
  const viewHeight = contentHeight + padding * 2;
  const output = outputDimensions(viewWidth, viewHeight);
  const strokeWidth = Math.max(1, (Math.max(viewWidth, viewHeight) / 512) * 1.75);

  const svgPaths = paths
    .map(
      (path) =>
        `<path d="${pathData(path.points)}" fill="none" stroke="${
          path.highlight ? "#f6c344" : "#111827"
        }" stroke-opacity="${path.highlight ? "0.55" : "1"}" stroke-width="${round(
          path.highlight ? strokeWidth * 4 : strokeWidth,
        )}" stroke-linecap="round" stroke-linejoin="round"/>`,
    )
    .join("");
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${output.width}" height="${
      output.height
    }" viewBox="${round(minX - padding)} ${round(minY - padding)} ${round(
      viewWidth,
    )} ${round(viewHeight)}" preserveAspectRatio="xMidYMid meet"><rect x="${round(
      minX - padding,
    )}" y="${round(minY - padding)}" width="${round(viewWidth)}" height="${round(
      viewHeight,
    )}" fill="#ffffff"/>${svgPaths}</svg>`,
    "utf8",
  );

  return sharp(svg, {
    limitInputPixels: AI_SELECTION_PREVIEW_MAX_DIMENSION ** 2,
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}
