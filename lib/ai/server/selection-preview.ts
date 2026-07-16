import "server-only";

import sharp from "sharp";

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
