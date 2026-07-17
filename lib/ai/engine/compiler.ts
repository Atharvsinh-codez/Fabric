import { CanvasPatchSchema, type CanvasOperation, type CanvasPatch } from "../canvas-patch";
import { hashCanonicalJson } from "../hash";
import {
  compiledConnectionNoteBodies,
  inlineDiagramConnectionLabel,
  type BoardProposal,
  type BoardPlanTone,
} from "./board-plan";
import type { AuthorizedBoardScene, AuthorizedSceneNode, SceneBounds } from "./authorized-scene";

export const CANVAS_COMPILER_VERSION = "fabric-canvas-compiler.v3" as const;

const NODE_GAP = 48;
const SECTION_GAP = 80;
const TEXT_TILE_GAP = 32;
const FLOW_COLUMN_GAP = 128;
const FLOW_ROW_GAP = 112;
const HIERARCHY_SIBLING_GAP = 72;
const HIERARCHY_LEVEL_GAP = 128;
const RADIAL_GAP = 80;
const FRAME_PADDING = 56;
// tldraw renders a frame's name just above its geometric bounds. Keep that
// visual overflow inside the deterministic group bounds so adjacent content
// can never cover the title.
const FRAME_TITLE_CLEARANCE = 48;
const CONNECTION_NOTES_GAP = 56;
const CONNECTION_NOTES_TILE_GAP = 32;
const CONNECTION_NOTES_WIDTH = 520;
const COLLISION_GAP = 32;
const PARENT_INTERIOR_PADDING = 24;
const SEARCH_STEP = 96;
const SEARCH_RINGS = 36;

type Point = Readonly<{ x: number; y: number }>;
type Size = Readonly<{ width: number; height: number }>;

type PositionedLayout = Readonly<{
  positions: readonly Point[];
  size: Size;
}>;

type GeneratedNode = Readonly<{
  logicalKey: string;
  tempId: string;
  nodeType: Extract<CanvasOperation, { type: "createNode" }>["nodeType"];
  position: Point;
  size: Size;
  content: Extract<CanvasOperation, { type: "createNode" }>["content"];
  appearance?: Extract<CanvasOperation, { type: "createNode" }>["appearance"];
  parentTempId?: string;
}>;

type GeneratedConnector = Readonly<{
  tempId: string;
  sourceTempId: string;
  targetTempId: string;
  route: "straight" | "elbow";
  label?: string;
}>;

type GeneratedGroup = Readonly<{
  nodes: readonly GeneratedNode[];
  connectors: readonly GeneratedConnector[];
  size: Size;
}>;

export type BoardPlanCompileErrorCode =
  | "unknown_selection_reference"
  | "mutation_not_allowed"
  | "duplicate_mutation"
  | "layout_failed"
  | "quality_failed";

export class BoardPlanCompileError extends Error {
  readonly code: BoardPlanCompileErrorCode;

  constructor(code: BoardPlanCompileErrorCode, message: string) {
    super(message);
    this.name = "BoardPlanCompileError";
    this.code = code;
  }
}

class TemporaryIdAllocator {
  #next = 1;

  constructor(private readonly namespace: string) {}

  allocate(): string {
    const id = `tmp_ai_${this.namespace}_${String(this.#next).padStart(3, "0")}`;
    this.#next += 1;
    return id;
  }
}

function temporaryIdNamespace(input: {
  proposal: BoardProposal;
  scene: AuthorizedBoardScene;
  base: CanvasPatch["base"];
}): string {
  // Persisted tldraw records use the temporary identifier as their semantic
  // Fabric node ID. Namespace it by the canonical compiler input so distinct
  // proposals cannot alias each other's records, while retries of the exact
  // same proposal remain byte-identical.
  return hashCanonicalJson({
    compilerVersion: CANVAS_COMPILER_VERSION,
    base: input.base,
    sceneHash: input.scene.hash,
    proposal: input.proposal,
  }).slice(0, 48);
}

const toneFill: Record<BoardPlanTone, NonNullable<GeneratedNode["appearance"]>["fill"]> = {
  neutral: "fog",
  blue: "sky",
  green: "mint",
  yellow: "butter",
  purple: "lavender",
  red: "rose",
};

function appearanceForTone(
  tone: BoardPlanTone | undefined,
  textColor?: NonNullable<GeneratedNode["appearance"]>["textColor"],
): GeneratedNode["appearance"] {
  if (!tone && !textColor) return undefined;
  return {
    ...(tone ? { fill: toneFill[tone] } : {}),
    ...(textColor ? { textColor } : {}),
  };
}

function textContent(text: string): GeneratedNode["content"] {
  const normalized = text.trim();
  if (normalized.length <= 200) return { title: normalized };
  let split = normalized.lastIndexOf(" ", 180);
  if (split < 80) split = 180;
  return {
    title: normalized.slice(0, split).trim(),
    body: normalized.slice(split).trim(),
  };
}

type TextBlockRole = Extract<
  BoardProposal["actions"][number],
  { kind: "composeText" }
>["blocks"][number]["role"];

function estimatedTextSize(text: string, role: TextBlockRole, fullWidth: boolean): Size {
  const width = fullWidth ? 712 : 336;
  const characterWidth = role === "heading" ? 14 : 11;
  const charactersPerLine = Math.max(16, Math.floor((width - 48) / characterWidth));
  const explicitLines = text.split(/\r?\n/);
  const lines = explicitLines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
  const minimumHeight = role === "heading" ? 112 : fullWidth ? 128 : 136;
  const lineHeight = role === "heading" ? 40 : 32;
  return {
    width,
    height: Math.max(minimumHeight, Math.min(720, 52 + lines * lineHeight)),
  };
}

function defaultTextTone(role: TextBlockRole, tileIndex: number): BoardPlanTone {
  if (role === "heading") return "blue";
  if (role === "answer") return "green";
  if (role === "equation") return "purple";
  if (role === "body") return "neutral";
  return (["neutral", "blue", "purple", "green"] as const)[tileIndex % 4]!;
}

function estimatedNodeSize(input: {
  title: string;
  body?: string;
  baseWidth: number;
  baseHeight: number;
}): Size {
  const textLength = input.title.length + (input.body?.length ?? 0);
  const width = Math.min(
    440,
    input.baseWidth + Math.max(0, Math.ceil((textLength - 180) / 180)) * 40,
  );
  const charactersPerLine = Math.max(18, Math.floor((width - 48) / 10));
  const text = [input.title, input.body].filter((value): value is string => Boolean(value)).join("\n\n");
  const lines = text.split(/\r?\n/).reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
  return {
    width,
    height: Math.max(input.baseHeight, Math.min(760, 64 + lines * 28)),
  };
}

function rect(position: Point, size: Size): SceneBounds {
  return { ...position, ...size };
}

function overlaps(left: SceneBounds, right: SceneBounds, gap = 0): boolean {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}

function boundsForRects(rects: readonly SceneBounds[]): SceneBounds {
  if (rects.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...rects.map((item) => item.x));
  const y = Math.min(...rects.map((item) => item.y));
  const right = Math.max(...rects.map((item) => item.x + item.width));
  const bottom = Math.max(...rects.map((item) => item.y + item.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Every local layout is expressed from its actual top-left bounds. Placement
 * and collision search can then use only `size` without losing negative
 * radial extents.
 */
function normalizeLayout(sizes: readonly Size[], positions: readonly Point[]): PositionedLayout {
  const bounds = boundsForRects(
    sizes.map((size, index) => rect(positions[index] ?? { x: 0, y: 0 }, size)),
  );
  return {
    positions: positions.map((position) => ({
      x: position.x - bounds.x,
      y: position.y - bounds.y,
    })),
    size: { width: Math.max(1, bounds.width), height: Math.max(1, bounds.height) },
  };
}

function gridPositions(sizes: readonly Size[], columns: number, gap = NODE_GAP): Point[] {
  const safeColumns = Math.max(1, Math.min(columns, sizes.length));
  const columnWidths = Array.from({ length: safeColumns }, () => 0);
  const rowCount = Math.ceil(sizes.length / safeColumns);
  const rowHeights = Array.from({ length: rowCount }, () => 0);
  sizes.forEach((size, index) => {
    const column = index % safeColumns;
    const row = Math.floor(index / safeColumns);
    columnWidths[column] = Math.max(columnWidths[column]!, size.width);
    rowHeights[row] = Math.max(rowHeights[row]!, size.height);
  });
  const columnX = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((total, value) => total + value, 0) + gap * index,
  );
  const rowY = rowHeights.map((_, index) =>
    rowHeights.slice(0, index).reduce((total, value) => total + value, 0) + gap * index,
  );
  return sizes.map((_, index) => ({
    x: columnX[index % safeColumns]!,
    y: rowY[Math.floor(index / safeColumns)]!,
  }));
}

function linearPositions(
  sizes: readonly Size[],
  direction: "horizontal" | "vertical",
  gap = NODE_GAP,
): Point[] {
  let cursor = 0;
  return sizes.map((size) => {
    const position = direction === "horizontal" ? { x: cursor, y: 0 } : { x: 0, y: cursor };
    cursor += (direction === "horizontal" ? size.width : size.height) + gap;
    return position;
  });
}

function serpentineGridPositions(
  sizes: readonly Size[],
  columns: number,
  columnGap: number,
  rowGap: number,
): Point[] {
  const safeColumns = Math.max(1, Math.min(columns, sizes.length));
  const rowCount = Math.ceil(sizes.length / safeColumns);
  const slots = sizes.map((_size, index) => {
    const row = Math.floor(index / safeColumns);
    const logicalColumn = index % safeColumns;
    const column = row % 2 === 0 ? logicalColumn : safeColumns - logicalColumn - 1;
    return { row, column };
  });
  const columnWidths = Array.from({ length: safeColumns }, () => 0);
  const rowHeights = Array.from({ length: rowCount }, () => 0);
  sizes.forEach((size, index) => {
    const slot = slots[index]!;
    columnWidths[slot.column] = Math.max(columnWidths[slot.column]!, size.width);
    rowHeights[slot.row] = Math.max(rowHeights[slot.row]!, size.height);
  });
  const columnX = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((total, value) => total + value, 0) + columnGap * index,
  );
  const rowY = rowHeights.map((_, index) =>
    rowHeights.slice(0, index).reduce((total, value) => total + value, 0) + rowGap * index,
  );
  return slots.map((slot) => ({ x: columnX[slot.column]!, y: rowY[slot.row]! }));
}

function circlePositions(sizes: readonly Size[], gap: number): Point[] {
  if (sizes.length === 0) return [];
  const maxWidth = Math.max(...sizes.map((size) => size.width));
  const maxHeight = Math.max(...sizes.map((size) => size.height));
  const minimumChord = Math.hypot(maxWidth + gap, maxHeight + gap);
  const radius = Math.max(
    160,
    minimumChord / (2 * Math.sin(Math.PI / Math.max(2, sizes.length))),
  );
  return sizes.map((size, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sizes.length;
    return {
      x: radius + Math.cos(angle) * radius - size.width / 2,
      y: radius + Math.sin(angle) * radius - size.height / 2,
    };
  });
}

function repositionNodes(nodes: readonly GeneratedNode[], positions: readonly Point[]): GeneratedNode[] {
  return nodes.map((node, index) => ({ ...node, position: positions[index]! }));
}

function createSimpleGroup(
  nodes: readonly Omit<GeneratedNode, "position">[],
  flow: "vertical" | "horizontal" | "grid",
): GeneratedGroup {
  const sizes = nodes.map((node) => node.size);
  const rawPositions = flow === "grid"
    ? gridPositions(sizes, Math.ceil(Math.sqrt(sizes.length)))
    : linearPositions(sizes, flow);
  const layout = normalizeLayout(sizes, rawPositions);
  const positioned = repositionNodes(
    nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })),
    layout.positions,
  );
  return { nodes: positioned, connectors: [], size: layout.size };
}

function leadingFullWidthTextBlocks(
  blocks: Extract<BoardProposal["actions"][number], { kind: "composeText" }>["blocks"],
): number {
  if (blocks[0]?.role === "heading") return blocks[1]?.role === "body" ? 2 : 1;
  return blocks.length >= 3 && blocks[0]?.role === "body" ? 1 : 0;
}

/**
 * Explanations read as one composition instead of a tower of identical cards:
 * an optional title/overview spans the full width, while the remaining facts
 * use a balanced two-column grid. Input order remains stable within both rows.
 */
function createTextGroup(
  nodes: readonly Omit<GeneratedNode, "position">[],
  fullWidthCount: number,
): GeneratedGroup {
  const positions: Point[] = nodes.map(() => ({ x: 0, y: 0 }));
  let cursorY = 0;

  for (let index = 0; index < fullWidthCount; index += 1) {
    positions[index] = { x: 0, y: cursorY };
    cursorY += nodes[index]!.size.height + TEXT_TILE_GAP;
  }

  const tiles = nodes.slice(fullWidthCount);
  if (tiles.length > 0) {
    const columns = tiles.length === 1 ? 1 : 2;
    const tileLayout = normalizeLayout(
      tiles.map((node) => node.size),
      gridPositions(tiles.map((node) => node.size), columns, TEXT_TILE_GAP),
    );
    const tileTop = fullWidthCount > 0 ? cursorY + 8 : 0;
    tileLayout.positions.forEach((position, tileIndex) => {
      positions[fullWidthCount + tileIndex] = {
        x: position.x,
        y: tileTop + position.y,
      };
    });
  }

  const layout = normalizeLayout(nodes.map((node) => node.size), positions);
  return {
    nodes: repositionNodes(
      nodes.map((node) => ({ ...node, position: { x: 0, y: 0 } })),
      layout.positions,
    ),
    connectors: [],
    size: layout.size,
  };
}

type DiagramAction = Extract<BoardProposal["actions"][number], { kind: "addDiagram" }>;

function diagramGraph(action: DiagramAction): {
  outgoing: number[][];
  incoming: number[][];
  neighbors: number[][];
} {
  const keyIndex = new Map(action.nodes.map((node, index) => [node.key, index]));
  const outgoing = action.nodes.map(() => [] as number[]);
  const incoming = action.nodes.map(() => [] as number[]);
  const neighbors = action.nodes.map(() => [] as number[]);
  for (const connection of action.connections) {
    const from = keyIndex.get(connection.from);
    const to = keyIndex.get(connection.to);
    if (from === undefined || to === undefined) continue;
    if (!outgoing[from]!.includes(to)) outgoing[from]!.push(to);
    if (!incoming[to]!.includes(from)) incoming[to]!.push(from);
    if (!neighbors[from]!.includes(to)) neighbors[from]!.push(to);
    if (!neighbors[to]!.includes(from)) neighbors[to]!.push(from);
  }
  return { outgoing, incoming, neighbors };
}

function defaultDiagramTone(action: DiagramAction, index: number): BoardPlanTone {
  const graph = diagramGraph(action);
  if (graph.incoming[index]!.length === 0) return "blue";
  if (graph.outgoing[index]!.length === 0) return "green";
  if (action.nodes[index]!.shape === "diamond" || graph.outgoing[index]!.length > 1) {
    return "yellow";
  }
  return index % 2 === 0 ? "purple" : "neutral";
}

function connectionNoteSize(title: string, body: string): Size {
  const charactersPerLine = Math.floor((CONNECTION_NOTES_WIDTH - 48) / 10);
  const lines = [title, body].reduce(
    (total, text) => total + text.split(/\r?\n/).reduce(
      (subtotal, line) => subtotal + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0,
    ),
    0,
  );
  return {
    width: CONNECTION_NOTES_WIDTH,
    height: Math.min(10_000, Math.max(160, 64 + lines * 28)),
  };
}

function connectorRoute(action: DiagramAction): "straight" | "elbow" {
  if (action.layout === "flow-vertical") return "straight";
  if (action.layout === "flow-horizontal" && action.nodes.length < 5) return "straight";
  if (action.layout === "mind-map" || action.layout === "cycle") return "straight";
  return "elbow";
}

function hierarchyPositions(action: DiagramAction, sizes: readonly Size[]): Point[] {
  const { outgoing, incoming } = diagramGraph(action);
  const remainingIncoming = incoming.map((items) => items.length);
  const ranks = sizes.map(() => -1);
  const queue = remainingIncoming.flatMap((count, index) => count === 0 ? [index] : []);
  queue.forEach((index) => { ranks[index] = 0; });

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const index = queue[cursor]!;
    for (const target of outgoing[index]!) {
      ranks[target] = Math.max(ranks[target]!, ranks[index]! + 1);
      remainingIncoming[target] -= 1;
      if (remainingIncoming[target] === 0) queue.push(target);
    }
  }

  // Hierarchy intent can still receive cyclic or disconnected input. Keep it
  // deterministic and topology-aware by ranking each remaining component with
  // a bounded breadth-first walk instead of pretending it is a flat list.
  for (let seed = 0; seed < ranks.length; seed += 1) {
    if (ranks[seed]! >= 0) continue;
    const predecessorRank = incoming[seed]!.reduce(
      (maximum, index) => Math.max(maximum, ranks[index]!),
      -1,
    );
    ranks[seed] = predecessorRank + 1;
    const componentQueue = [seed];
    for (let cursor = 0; cursor < componentQueue.length; cursor += 1) {
      const index = componentQueue[cursor]!;
      for (const target of outgoing[index]!) {
        if (ranks[target]! >= 0) continue;
        ranks[target] = ranks[index]! + 1;
        componentQueue.push(target);
      }
    }
  }

  const levels = new Map<number, number[]>();
  ranks.forEach((rank, index) => {
    const level = levels.get(rank) ?? [];
    level.push(index);
    levels.set(rank, level);
  });
  const orderedLevels = [...levels.entries()].sort(([left], [right]) => left - right);
  const levelWidths = orderedLevels.map(([, indices]) =>
    indices.reduce((total, index) => total + sizes[index]!.width, 0) +
      Math.max(0, indices.length - 1) * HIERARCHY_SIBLING_GAP,
  );
  const totalWidth = Math.max(...levelWidths, 1);
  const positions = sizes.map(() => ({ x: 0, y: 0 }));
  let y = 0;
  orderedLevels.forEach(([, indices], levelIndex) => {
    let x = (totalWidth - levelWidths[levelIndex]!) / 2;
    let levelHeight = 0;
    indices.forEach((index) => {
      positions[index] = { x, y };
      x += sizes[index]!.width + HIERARCHY_SIBLING_GAP;
      levelHeight = Math.max(levelHeight, sizes[index]!.height);
    });
    y += levelHeight + HIERARCHY_LEVEL_GAP;
  });
  return positions;
}

function traversalOrder(action: DiagramAction, start: number, directed: boolean): number[] {
  const graph = diagramGraph(action);
  const adjacency = directed ? graph.outgoing : graph.neighbors;
  const visited = new Set<number>();
  const order: number[] = [];
  const visitComponent = (seed: number): void => {
    const queue = [seed];
    visited.add(seed);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const index = queue[cursor]!;
      order.push(index);
      for (const target of adjacency[index]!) {
        if (visited.has(target)) continue;
        visited.add(target);
        queue.push(target);
      }
    }
  };
  visitComponent(start);
  for (let index = 0; index < action.nodes.length; index += 1) {
    if (!visited.has(index)) visitComponent(index);
  }
  return order;
}

function orderedCirclePositions(sizes: readonly Size[], order: readonly number[], gap: number): Point[] {
  const orderedSizes = order.map((index) => sizes[index]!);
  const orderedPositions = circlePositions(orderedSizes, gap);
  const positions = sizes.map(() => ({ x: 0, y: 0 }));
  order.forEach((nodeIndex, orderIndex) => {
    positions[nodeIndex] = orderedPositions[orderIndex]!;
  });
  return positions;
}

function mindMapPositions(action: DiagramAction, sizes: readonly Size[]): Point[] {
  const graph = diagramGraph(action);
  const roots = action.nodes.flatMap((_, index) =>
    graph.incoming[index]!.length === 0 && graph.outgoing[index]!.length > 0 ? [index] : [],
  );
  const candidates = roots.length > 0 ? roots : action.nodes.map((_, index) => index);
  const center = candidates.reduce((best, index) => {
    const degree = graph.neighbors[index]!.length;
    const bestDegree = graph.neighbors[best]!.length;
    return degree > bestDegree ? index : best;
  }, candidates[0] ?? 0);
  const peripheral = traversalOrder(action, center, false).filter((index) => index !== center);
  const centerSize = sizes[center]!;
  const maxWidth = Math.max(...peripheral.map((index) => sizes[index]!.width));
  const maxHeight = Math.max(...peripheral.map((index) => sizes[index]!.height));
  const centerClearance = Math.hypot(
    (centerSize.width + maxWidth) / 2 + RADIAL_GAP,
    (centerSize.height + maxHeight) / 2 + RADIAL_GAP,
  );
  const ringChord = Math.hypot(maxWidth + RADIAL_GAP, maxHeight + RADIAL_GAP);
  const ringRadius = peripheral.length <= 1
    ? centerClearance
    : ringChord / (2 * Math.sin(Math.PI / peripheral.length));
  const radius = Math.max(240, centerClearance, ringRadius);
  const positions = sizes.map(() => ({ x: 0, y: 0 }));
  positions[center] = { x: -centerSize.width / 2, y: -centerSize.height / 2 };
  peripheral.forEach((nodeIndex, orderIndex) => {
    const angle = -Math.PI / 2 + (orderIndex * 2 * Math.PI) / peripheral.length;
    positions[nodeIndex] = {
      x: Math.cos(angle) * radius - sizes[nodeIndex]!.width / 2,
      y: Math.sin(angle) * radius - sizes[nodeIndex]!.height / 2,
    };
  });
  return positions;
}

function diagramPositions(
  action: DiagramAction,
  sizes: readonly Size[],
): Point[] {
  if (action.layout === "flow-horizontal") {
    if (sizes.length >= 5) {
      const columns = Math.min(4, Math.ceil(Math.sqrt(sizes.length)));
      return serpentineGridPositions(sizes, columns, FLOW_COLUMN_GAP, FLOW_ROW_GAP);
    }
    return linearPositions(sizes, "horizontal", FLOW_COLUMN_GAP);
  }
  if (action.layout === "flow-vertical") {
    return linearPositions(sizes, "vertical", HIERARCHY_LEVEL_GAP);
  }
  if (action.layout === "hierarchy") return hierarchyPositions(action, sizes);
  if (action.layout === "mind-map") return mindMapPositions(action, sizes);
  if (action.layout === "cycle") {
    return orderedCirclePositions(sizes, traversalOrder(action, 0, true), RADIAL_GAP);
  }
  return gridPositions(sizes, Math.ceil(Math.sqrt(sizes.length)));
}

function desiredOrigin(
  scene: AuthorizedBoardScene,
  placement: BoardProposal["placement"],
  size: Size,
): Point {
  const selection = scene.selectionBounds;
  if (placement === "selection-right" && selection) {
    return { x: selection.x + selection.width + 80, y: selection.y };
  }
  if (placement === "selection-below" && selection) {
    return { x: selection.x, y: selection.y + selection.height + 80 };
  }
  return {
    x: scene.viewport.x + Math.max(24, (scene.viewport.width - size.width) / 2),
    y: scene.viewport.y + Math.max(24, (scene.viewport.height - size.height) / 2),
  };
}

function candidateOrigins(origin: Point): Point[] {
  const candidates: Point[] = [origin];
  for (let ring = 1; ring <= SEARCH_RINGS; ring += 1) {
    for (let dx = -ring; dx <= ring; dx += 1) {
      candidates.push(
        { x: origin.x + dx * SEARCH_STEP, y: origin.y - ring * SEARCH_STEP },
        { x: origin.x + dx * SEARCH_STEP, y: origin.y + ring * SEARCH_STEP },
      );
    }
    for (let dy = -ring + 1; dy < ring; dy += 1) {
      candidates.push(
        { x: origin.x - ring * SEARCH_STEP, y: origin.y + dy * SEARCH_STEP },
        { x: origin.x + ring * SEARCH_STEP, y: origin.y + dy * SEARCH_STEP },
      );
    }
  }
  return candidates;
}

function freeOrigin(input: {
  desired: Point;
  size: Size;
  obstacles: readonly SceneBounds[];
  boundary?: SceneBounds;
}): Point {
  for (const candidate of candidateOrigins(input.desired)) {
    const candidateRect = rect(candidate, input.size);
    if (
      Math.abs(candidate.x) <= 99_000 &&
      Math.abs(candidate.y) <= 99_000 &&
      (!input.boundary ||
        (candidateRect.x >= input.boundary.x &&
          candidateRect.y >= input.boundary.y &&
          candidateRect.x + candidateRect.width <= input.boundary.x + input.boundary.width &&
          candidateRect.y + candidateRect.height <= input.boundary.y + input.boundary.height)) &&
      input.obstacles.every((obstacle) => !overlaps(candidateRect, obstacle, COLLISION_GAP))
    ) {
      return candidate;
    }
  }
  throw new BoardPlanCompileError("layout_failed", "Fabric could not find collision-free canvas space.");
}

function offsetGroup(group: GeneratedGroup, offset: Point): GeneratedGroup {
  return {
    ...group,
    nodes: group.nodes.map((node) => ({
      ...node,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
    })),
  };
}

function writableNode(scene: AuthorizedBoardScene, reference: string): AuthorizedSceneNode {
  const node = scene.nodes.find((candidate) => candidate.handle === reference);
  if (!node || !node.writable || !scene.writableHandles.includes(reference)) {
    throw new BoardPlanCompileError(
      "unknown_selection_reference",
      "The plan referenced an object outside the authorized writable canvas scope.",
    );
  }
  return node;
}

function requireMutation(node: AuthorizedSceneNode, mutation: "move" | "content" | "style"): void {
  if (!node.allowedMutations.includes(mutation)) {
    throw new BoardPlanCompileError(
      "mutation_not_allowed",
      `The authorized ${node.type} object does not allow ${mutation} changes.`,
    );
  }
}

function enclosingBounds(nodes: readonly AuthorizedSceneNode[]): SceneBounds {
  const minX = Math.min(...nodes.map((node) => node.bounds.x));
  const minY = Math.min(...nodes.map((node) => node.bounds.y));
  const maxX = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.width));
  const maxY = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function insetBounds(bounds: SceneBounds, inset: number): SceneBounds | null {
  const width = bounds.width - inset * 2;
  const height = bounds.height - inset * 2;
  return width > 0 && height > 0
    ? { x: bounds.x + inset, y: bounds.y + inset, width, height }
    : null;
}

function intersectBounds(left: SceneBounds, right: SceneBounds): SceneBounds | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
  return rightEdge > x && bottomEdge > y
    ? { x, y, width: rightEdge - x, height: bottomEdge - y }
    : null;
}

function boundedOrigin(desired: Point, size: Size, boundary: SceneBounds): Point {
  if (size.width > boundary.width || size.height > boundary.height) {
    throw new BoardPlanCompileError(
      "layout_failed",
      "The requested arrangement does not fit inside its authorized container.",
    );
  }
  return {
    x: Math.max(boundary.x, Math.min(desired.x, boundary.x + boundary.width - size.width)),
    y: Math.max(boundary.y, Math.min(desired.y, boundary.y + boundary.height - size.height)),
  };
}

function arrangedPositions(
  nodes: readonly AuthorizedSceneNode[],
  arrangement: "row" | "column" | "grid" | "circle",
  gap: number,
): Point[] {
  const sizes = nodes.map((node) => ({ width: node.bounds.width, height: node.bounds.height }));
  if (arrangement === "row") return linearPositions(sizes, "horizontal", gap);
  if (arrangement === "column") return linearPositions(sizes, "vertical", gap);
  if (arrangement === "circle") return circlePositions(sizes, gap);
  return gridPositions(sizes, Math.ceil(Math.sqrt(sizes.length)), gap);
}

function nativeNodeType(
  value: "note" | "summary" | "rectangle" | "ellipse" | "diamond" | "triangle" | "hexagon",
): GeneratedNode["nodeType"] {
  return value;
}

function assertCompiledPatchQuality(patch: CanvasPatch, scene: AuthorizedBoardScene): void {
  const created = new Set<string>();
  const createdRects: Array<{ id: string; bounds: SceneBounds; parentId?: string }> = [];
  const existingIds = new Set(scene.nodes.map((node) => node.id));
  const finalExistingBounds = new Map(scene.nodes.map((node) => [node.id, node.bounds]));
  const sceneNodeById = new Map(scene.nodes.map((node) => [node.id, node]));
  const sceneNodeByHandle = new Map(scene.nodes.map((node) => [node.handle, node]));
  const movedIds = new Set<string>();
  for (const operation of patch.operations) {
    const available = (value: string): boolean => existingIds.has(value) || created.has(value);
    if (operation.type === "createNode") {
      if (operation.parentId && !available(operation.parentId)) {
        throw new BoardPlanCompileError("quality_failed", "A parent was referenced before creation.");
      }
      created.add(operation.tempId);
      createdRects.push({
        id: operation.tempId,
        bounds: rect(operation.position, operation.size),
        ...(operation.parentId ? { parentId: operation.parentId } : {}),
      });
    } else if (operation.type === "createConnector") {
      if (!available(operation.sourceId) || !available(operation.targetId)) {
        throw new BoardPlanCompileError("quality_failed", "A connector endpoint was referenced before creation.");
      }
      created.add(operation.tempId);
    } else if (operation.type === "writeText" || operation.type === "createDrawing") {
      if (operation.parentId && !available(operation.parentId)) {
        throw new BoardPlanCompileError("quality_failed", "A drawing parent was referenced before creation.");
      }
      created.add(operation.tempId);
    } else {
      if (!available(operation.nodeId)) {
        throw new BoardPlanCompileError("quality_failed", "A mutation target was unavailable at execution time.");
      }
      if (operation.type === "moveNode") {
        const current = finalExistingBounds.get(operation.nodeId);
        if (current) {
          finalExistingBounds.set(operation.nodeId, {
            ...operation.position,
            width: current.width,
            height: current.height,
          });
          movedIds.add(operation.nodeId);
        }
      }
    }
  }

  for (let leftIndex = 0; leftIndex < createdRects.length; leftIndex += 1) {
    const left = createdRects[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < createdRects.length; rightIndex += 1) {
      const right = createdRects[rightIndex]!;
      const parentChild = left.parentId === right.id || right.parentId === left.id;
      if (!parentChild && overlaps(left.bounds, right.bounds, 12)) {
        throw new BoardPlanCompileError("quality_failed", "Generated canvas objects overlap.");
      }
    }
  }

  for (const movedId of movedIds) {
    const moved = finalExistingBounds.get(movedId)!;
    const ancestorIds = new Set<string>();
    let parentHandle = sceneNodeById.get(movedId)?.parentHandle;
    while (parentHandle) {
      const parent = sceneNodeByHandle.get(parentHandle);
      if (!parent) break;
      ancestorIds.add(parent.id);
      parentHandle = parent.parentHandle;
    }
    for (const [otherId, other] of finalExistingBounds) {
      if (otherId !== movedId && !ancestorIds.has(otherId) && overlaps(moved, other, 12)) {
        throw new BoardPlanCompileError(
          "quality_failed",
          "Arranged canvas objects overlap another board object.",
        );
      }
    }
  }

  for (const createdRect of createdRects) {
    for (const existing of finalExistingBounds.values()) {
      if (overlaps(createdRect.bounds, existing, 12)) {
        throw new BoardPlanCompileError(
          "quality_failed",
          "Generated canvas objects overlap an existing board object.",
        );
      }
    }
  }
}

export function compileBoardProposal(input: {
  proposal: BoardProposal;
  scene: AuthorizedBoardScene;
  base: CanvasPatch["base"];
}): CanvasPatch {
  const allocator = new TemporaryIdAllocator(temporaryIdNamespace(input));
  const groups: GeneratedGroup[] = [];
  const movementByNode = new Map<string, Extract<CanvasOperation, { type: "moveNode" }>>();
  const plannedMovementBounds = new Map<string, SceneBounds>();
  const updateByNode = new Map<string, Extract<CanvasOperation, { type: "updateNode" }>>();

  for (const action of input.proposal.actions) {
    if (action.kind === "composeText") {
      const fullWidthCount = leadingFullWidthTextBlocks(action.blocks);
      const nodes = action.blocks.map((block, index) => {
        const tone = action.tone ?? defaultTextTone(block.role, index - fullWidthCount);
        const strongHeading = block.role === "heading" &&
          tone !== "neutral" && tone !== "yellow";
        return {
          logicalKey: `${action.key}/block-${index + 1}`,
          tempId: allocator.allocate(),
          // A bounded native geo text block preserves Unicode, equations, and
          // multilingual content exactly. The lossy bitmap pen renderer is not
          // used for arbitrary model text.
          nodeType: "summary" as const,
          size: estimatedTextSize(block.text, block.role, index < fullWidthCount),
          content: textContent(block.text),
          appearance: appearanceForTone(tone, strongHeading ? "surface" : "ink"),
        };
      });
      groups.push(createTextGroup(nodes, fullWidthCount));
      continue;
    }

    if (action.kind === "addCards") {
      const nodes = action.cards.map((card, index) => ({
        logicalKey: card.key,
        tempId: allocator.allocate(),
        nodeType: card.variant,
        size: estimatedNodeSize({
          title: card.title,
          ...(card.body !== undefined ? { body: card.body } : {}),
          baseWidth: card.variant === "note" ? 280 : 340,
          baseHeight: card.variant === "note" ? 200 : 190,
        }),
        content: { title: card.title, ...(card.body !== undefined ? { body: card.body } : {}) },
        appearance: appearanceForTone(
          card.tone ??
            (card.variant === "note"
              ? (["yellow", "neutral", "blue", "green"] as const)[index % 4]!
              : (["neutral", "blue", "purple", "green"] as const)[index % 4]!),
          "ink",
        ),
      }));
      groups.push(createSimpleGroup(nodes, input.proposal.flow));
      continue;
    }

    if (action.kind === "addShapes") {
      const nodes = action.shapes.map((shape, index) => ({
        logicalKey: shape.key,
        tempId: allocator.allocate(),
        nodeType: shape.shape,
        size: estimatedNodeSize({
          title: shape.label,
          ...(shape.detail !== undefined ? { body: shape.detail } : {}),
          baseWidth: 280,
          baseHeight: shape.detail ? 170 : 130,
        }),
        content: { title: shape.label, ...(shape.detail !== undefined ? { body: shape.detail } : {}) },
        appearance: appearanceForTone(
          shape.tone ?? (["blue", "neutral", "purple", "green"] as const)[index % 4]!,
          "ink",
        ),
      }));
      groups.push(createSimpleGroup(nodes, input.proposal.flow));
      continue;
    }

    if (action.kind === "addDiagram") {
      const frameTempId = allocator.allocate();
      const rawNodes = action.nodes.map((node, index) => {
        const isNarrowInterior = node.shape === "diamond" || node.shape === "triangle";
        return {
          logicalKey: `${action.key}/${node.key}`,
          tempId: allocator.allocate(),
          nodeType: nativeNodeType(node.shape),
          position: { x: 0, y: 0 },
          size: estimatedNodeSize({
            title: node.label,
            ...(node.detail !== undefined ? { body: node.detail } : {}),
            baseWidth: isNarrowInterior ? 320 : 288,
            baseHeight: node.detail ? (isNarrowInterior ? 208 : 176) : (isNarrowInterior ? 176 : 144),
          }),
          content: {
            title: node.label,
            ...(node.detail !== undefined ? { body: node.detail } : {}),
          },
          appearance: appearanceForTone(node.tone ?? defaultDiagramTone(action, index), "ink"),
          parentTempId: frameTempId,
        };
      });
      const childSizes = rawNodes.map((node) => node.size);
      const diagramLayout = normalizeLayout(childSizes, diagramPositions(action, childSizes));
      const connectionBodies = compiledConnectionNoteBodies(action);
      const rawConnectionNotes = connectionBodies.map((body, index) => {
        const title = connectionBodies.length === 1
          ? "Connection notes"
          : `Connection notes \u00b7 ${index + 1} of ${connectionBodies.length}`;
        return {
          logicalKey: `${action.key}/connection-notes-${index + 1}`,
          tempId: allocator.allocate(),
          nodeType: "summary" as const,
          position: { x: 0, y: 0 },
          size: connectionNoteSize(title, body),
          content: { title, body },
          appearance: appearanceForTone("neutral", "ink"),
          parentTempId: frameTempId,
        };
      });
      const connectionNotesLayout = rawConnectionNotes.length > 0
        ? normalizeLayout(
            rawConnectionNotes.map((node) => node.size),
            gridPositions(
              rawConnectionNotes.map((node) => node.size),
              Math.min(4, Math.ceil(Math.sqrt(rawConnectionNotes.length))),
              CONNECTION_NOTES_TILE_GAP,
            ),
          )
        : null;
      const belowSize = connectionNotesLayout
        ? {
            width: Math.max(diagramLayout.size.width, connectionNotesLayout.size.width),
            height: diagramLayout.size.height + CONNECTION_NOTES_GAP + connectionNotesLayout.size.height,
          }
        : diagramLayout.size;
      const besideSize = connectionNotesLayout
        ? {
            width: diagramLayout.size.width + CONNECTION_NOTES_GAP + connectionNotesLayout.size.width,
            height: Math.max(diagramLayout.size.height, connectionNotesLayout.size.height),
          }
        : diagramLayout.size;
      const notesBesideDiagram = Boolean(
        connectionNotesLayout &&
        Math.max(besideSize.width, besideSize.height) < Math.max(belowSize.width, belowSize.height),
      );
      const contentSize = notesBesideDiagram ? besideSize : belowSize;
      const diagramOffset = notesBesideDiagram
        ? { x: 0, y: (contentSize.height - diagramLayout.size.height) / 2 }
        : { x: (contentSize.width - diagramLayout.size.width) / 2, y: 0 };
      const positionedChildren = repositionNodes(rawNodes, diagramLayout.positions).map((node) => ({
        ...node,
        position: {
          x: node.position.x + diagramOffset.x + FRAME_PADDING,
          y: node.position.y + diagramOffset.y + FRAME_TITLE_CLEARANCE + FRAME_PADDING,
        },
      }));
      const notesOffset = connectionNotesLayout
        ? notesBesideDiagram
          ? {
              x: diagramLayout.size.width + CONNECTION_NOTES_GAP,
              y: (contentSize.height - connectionNotesLayout.size.height) / 2,
            }
          : {
              x: (contentSize.width - connectionNotesLayout.size.width) / 2,
              y: diagramLayout.size.height + CONNECTION_NOTES_GAP,
            }
        : { x: 0, y: 0 };
      const positionedConnectionNotes = connectionNotesLayout
        ? repositionNodes(rawConnectionNotes, connectionNotesLayout.positions).map((node) => ({
            ...node,
            position: {
              x: node.position.x + notesOffset.x + FRAME_PADDING,
              y: node.position.y + notesOffset.y + FRAME_TITLE_CLEARANCE + FRAME_PADDING,
            },
          }))
        : [];
      const frame: GeneratedNode = {
        logicalKey: action.key,
        tempId: frameTempId,
        nodeType: "frame",
        position: { x: 0, y: FRAME_TITLE_CLEARANCE },
        size: {
          width: contentSize.width + FRAME_PADDING * 2,
          height: contentSize.height + FRAME_PADDING * 2,
        },
        content: { title: action.title ?? input.proposal.summary.slice(0, 120) },
        appearance: { fill: "fog" },
      };
      const keyToTemp = new Map(
        action.nodes.map((node, index) => [node.key, positionedChildren[index]!.tempId]),
      );
      const route = connectorRoute(action);
      const connectors = action.connections.map((connection) => {
        const label = inlineDiagramConnectionLabel(action, connection.label);
        return {
          tempId: allocator.allocate(),
          sourceTempId: keyToTemp.get(connection.from)!,
          targetTempId: keyToTemp.get(connection.to)!,
          route,
          ...(label ? { label } : {}),
        };
      });
      groups.push({
        nodes: [frame, ...positionedChildren, ...positionedConnectionNotes],
        connectors,
        size: {
          width: frame.size.width,
          height: frame.size.height + FRAME_TITLE_CLEARANCE,
        },
      });
      continue;
    }

    if (action.kind === "arrangeSelection") {
      const targets = action.selectionRefs.map((reference) => writableNode(input.scene, reference));
      targets.forEach((node) => requireMutation(node, "move"));
      const targetHandles = new Set(action.selectionRefs);
      const nodeByHandle = new Map(input.scene.nodes.map((node) => [node.handle, node]));
      for (const node of targets) {
        let parentHandle = node.parentHandle;
        while (parentHandle) {
          if (targetHandles.has(parentHandle)) {
            throw new BoardPlanCompileError(
              "layout_failed",
              "Nested parent and child objects must be arranged in separate proposals.",
            );
          }
          parentHandle = nodeByHandle.get(parentHandle)?.parentHandle;
        }
      }
      const parentHandles = new Set(targets.map((node) => node.parentHandle ?? null));
      if (parentHandles.size !== 1) {
        throw new BoardPlanCompileError(
          "layout_failed",
          "Objects from different containers must be arranged in separate proposals.",
        );
      }
      const commonParentHandle = targets[0]!.parentHandle;
      const commonParent = commonParentHandle
        ? nodeByHandle.get(commonParentHandle)
        : undefined;
      if (commonParentHandle && !commonParent) {
        throw new BoardPlanCompileError(
          "layout_failed",
          "The authorized parent container is unavailable.",
        );
      }
      if (targets.some((node) => movementByNode.has(node.id))) {
        throw new BoardPlanCompileError(
          "duplicate_mutation",
          "A writable object cannot be arranged more than once in one proposal.",
        );
      }
      const gap = action.spacing === "compact" ? 24 : action.spacing === "spacious" ? 80 : 48;
      const sizes = targets.map((node) => ({
        width: node.bounds.width,
        height: node.bounds.height,
      }));
      const arrangement = normalizeLayout(
        sizes,
        arrangedPositions(targets, action.arrangement, gap),
      );
      const targetIds = new Set(targets.map((node) => node.id));
      const containerIds = new Set<string>();
      let container = commonParent;
      while (container) {
        containerIds.add(container.id);
        container = container.parentHandle ? nodeByHandle.get(container.parentHandle) : undefined;
      }
      const obstacles = input.scene.nodes
        .filter((node) => !targetIds.has(node.id) && !containerIds.has(node.id))
        .map((node) => plannedMovementBounds.get(node.id) ?? node.bounds);
      const targetBounds = enclosingBounds(targets);
      const viewportScoped = targets.every((node) => node.role === "visible");
      const parentInterior = commonParent
        ? insetBounds(commonParent.bounds, PARENT_INTERIOR_PADDING)
        : null;
      const boundary = commonParent
        ? parentInterior && intersectBounds(parentInterior, input.scene.viewport)
        : viewportScoped
          ? input.scene.viewport
          : undefined;
      if (commonParent && !boundary) {
        throw new BoardPlanCompileError(
          "layout_failed",
          "The parent container has no authorized interior inside the viewport.",
        );
      }
      const start = boundary
        ? boundedOrigin(
            { x: targetBounds.x, y: targetBounds.y },
            arrangement.size,
            boundary,
          )
        : input.scene.selectionBounds
          ? { x: input.scene.selectionBounds.x, y: input.scene.selectionBounds.y }
          : { x: targetBounds.x, y: targetBounds.y };
      const origin = freeOrigin({
        desired: start,
        size: arrangement.size,
        obstacles,
        ...(boundary ? { boundary } : {}),
      });
      targets.forEach((node, index) => {
        const position = {
          x: origin.x + arrangement.positions[index]!.x,
          y: origin.y + arrangement.positions[index]!.y,
        };
        movementByNode.set(node.id, {
          type: "moveNode",
          nodeId: node.id,
          position,
        });
        plannedMovementBounds.set(node.id, rect(position, sizes[index]!));
      });
      continue;
    }

    if (action.kind === "editSelection") {
      for (const edit of action.edits) {
        const node = writableNode(input.scene, edit.selectionRef);
        requireMutation(node, "content");
        const current = updateByNode.get(node.id);
        updateByNode.set(node.id, {
          type: "updateNode",
          nodeId: node.id,
          content: {
            ...(current?.content ?? {}),
            ...(edit.title !== undefined ? { title: edit.title } : {}),
            ...(edit.body !== undefined ? { body: edit.body } : {}),
            ...(edit.tag !== undefined ? { tag: edit.tag } : {}),
          },
          ...(current?.appearance ? { appearance: current.appearance } : {}),
        });
      }
      continue;
    }

    for (const reference of action.selectionRefs) {
      const node = writableNode(input.scene, reference);
      requireMutation(node, "style");
      const current = updateByNode.get(node.id);
      updateByNode.set(node.id, {
        type: "updateNode",
        nodeId: node.id,
        ...(current?.content ? { content: current.content } : {}),
        appearance: {
          ...(current?.appearance ?? {}),
          ...(action.style.tone ? { fill: toneFill[action.style.tone] } : {}),
          ...(action.style.textTone
            ? {
                textColor: action.style.textTone === "light"
                  ? "surface"
                  : action.style.textTone === "muted"
                    ? "muted"
                    : "ink",
              }
            : {}),
        },
      });
    }
  }

  const groupSizes = groups.map((group) => group.size);
  const rawGroupPositions = input.proposal.flow === "grid"
    ? gridPositions(groupSizes, Math.ceil(Math.sqrt(groupSizes.length || 1)), 72)
    : linearPositions(groupSizes, input.proposal.flow, SECTION_GAP);
  const creationLayout = groupSizes.length > 0
    ? normalizeLayout(groupSizes, rawGroupPositions)
    : null;
  let positionedGroups = groups;
  if (creationLayout) {
    const desired = desiredOrigin(input.scene, input.proposal.placement, creationLayout.size);
    const origin = freeOrigin({
      desired,
      size: creationLayout.size,
      obstacles: input.scene.nodes.map(
        (node) => plannedMovementBounds.get(node.id) ?? node.bounds,
      ),
    });
    positionedGroups = groups.map((group, index) => offsetGroup(group, {
      x: origin.x + creationLayout.positions[index]!.x,
      y: origin.y + creationLayout.positions[index]!.y,
    }));
  }

  const operations: CanvasOperation[] = [
    ...[...movementByNode.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
    ...[...updateByNode.values()].sort((left, right) => left.nodeId.localeCompare(right.nodeId)),
  ];
  for (const group of positionedGroups) {
    // Frames are always first, then their children; connectors are emitted only
    // after every endpoint exists. This is executable by the sequential adapter.
    for (const node of group.nodes) {
      operations.push({
        type: "createNode",
        tempId: node.tempId,
        nodeType: node.nodeType,
        position: node.position,
        size: node.size,
        content: node.content,
        ...(node.appearance ? { appearance: node.appearance } : {}),
        ...(node.parentTempId ? { parentId: node.parentTempId } : {}),
      });
    }
    for (const connector of group.connectors) {
      operations.push({
        type: "createConnector",
        tempId: connector.tempId,
        sourceId: connector.sourceTempId,
        targetId: connector.targetTempId,
        route: connector.route,
        ...(connector.label ? { label: connector.label } : {}),
      });
    }
  }

  const patch = CanvasPatchSchema.parse({
    schemaVersion: 1,
    summary: input.proposal.summary,
    base: input.base,
    operations,
  });
  assertCompiledPatchQuality(patch, input.scene);
  return patch;
}
