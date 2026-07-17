import { CanvasPatchSchema, type CanvasOperation, type CanvasPatch } from "../canvas-patch";
import { hashCanonicalJson } from "../hash";
import type { BoardProposal, BoardPlanTone } from "./board-plan";
import type { AuthorizedBoardScene, AuthorizedSceneNode, SceneBounds } from "./authorized-scene";

export const CANVAS_COMPILER_VERSION = "fabric-canvas-compiler.v2" as const;

const NODE_GAP = 48;
const FRAME_PADDING = 48;
const FRAME_HEADER = 56;
const COLLISION_GAP = 32;
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

function appearanceForTone(tone: BoardPlanTone | undefined): GeneratedNode["appearance"] {
  return tone ? { fill: toneFill[tone] } : undefined;
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

function estimatedTextSize(text: string, role: string): Size {
  const width = role === "heading" ? 560 : 520;
  const charactersPerLine = Math.max(16, Math.floor(width / (role === "heading" ? 13 : 11)));
  const explicitLines = text.split(/\r?\n/);
  const lines = explicitLines.reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charactersPerLine)),
    0,
  );
  return {
    width,
    height: Math.max(96, Math.min(720, 52 + lines * (role === "heading" ? 38 : 32))),
  };
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
      Math.max(0, indices.length - 1) * NODE_GAP,
  );
  const totalWidth = Math.max(...levelWidths, 1);
  const positions = sizes.map(() => ({ x: 0, y: 0 }));
  let y = 0;
  orderedLevels.forEach(([, indices], levelIndex) => {
    let x = (totalWidth - levelWidths[levelIndex]!) / 2;
    let levelHeight = 0;
    indices.forEach((index) => {
      positions[index] = { x, y };
      x += sizes[index]!.width + NODE_GAP;
      levelHeight = Math.max(levelHeight, sizes[index]!.height);
    });
    y += levelHeight + NODE_GAP;
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
    (centerSize.width + maxWidth) / 2 + NODE_GAP,
    (centerSize.height + maxHeight) / 2 + NODE_GAP,
  );
  const ringChord = Math.hypot(maxWidth + NODE_GAP, maxHeight + NODE_GAP);
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
  if (action.layout === "flow-horizontal") return linearPositions(sizes, "horizontal");
  if (action.layout === "flow-vertical") {
    return linearPositions(sizes, "vertical");
  }
  if (action.layout === "hierarchy") return hierarchyPositions(action, sizes);
  if (action.layout === "mind-map") return mindMapPositions(action, sizes);
  if (action.layout === "cycle") {
    return orderedCirclePositions(sizes, traversalOrder(action, 0, true), NODE_GAP);
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
}): Point {
  for (const candidate of candidateOrigins(input.desired)) {
    const candidateRect = rect(candidate, input.size);
    if (
      Math.abs(candidate.x) <= 99_000 &&
      Math.abs(candidate.y) <= 99_000 &&
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

function selectedNode(scene: AuthorizedBoardScene, reference: string): AuthorizedSceneNode {
  const node = scene.nodes.find((candidate) => candidate.handle === reference);
  if (!node || node.role !== "selected") {
    throw new BoardPlanCompileError(
      "unknown_selection_reference",
      "The plan referenced an object outside the authorized selection.",
    );
  }
  return node;
}

function requireMutation(node: AuthorizedSceneNode, mutation: "move" | "content" | "style"): void {
  if (!node.allowedMutations.includes(mutation)) {
    throw new BoardPlanCompileError(
      "mutation_not_allowed",
      `The selected ${node.type} object does not allow ${mutation} changes.`,
    );
  }
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
    for (const [otherId, other] of finalExistingBounds) {
      if (otherId !== movedId && overlaps(moved, other, 12)) {
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
      const nodes = action.blocks.map((block, index) => ({
        logicalKey: `${action.key}/block-${index + 1}`,
        tempId: allocator.allocate(),
        // A bounded native geo text block preserves Unicode, equations, and
        // multilingual content exactly. The lossy bitmap pen renderer is not
        // used for arbitrary model text.
        nodeType: "summary" as const,
        size: estimatedTextSize(block.text, block.role),
        content: textContent(block.text),
        appearance: appearanceForTone(action.tone ?? (block.role === "answer" ? "green" : "neutral")),
      }));
      groups.push(createSimpleGroup(nodes, "vertical"));
      continue;
    }

    if (action.kind === "addCards") {
      const nodes = action.cards.map((card) => ({
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
        appearance: appearanceForTone(card.tone ?? (card.variant === "note" ? "yellow" : "neutral")),
      }));
      groups.push(createSimpleGroup(nodes, input.proposal.flow));
      continue;
    }

    if (action.kind === "addShapes") {
      const nodes = action.shapes.map((shape) => ({
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
        appearance: appearanceForTone(shape.tone ?? "blue"),
      }));
      groups.push(createSimpleGroup(nodes, input.proposal.flow));
      continue;
    }

    if (action.kind === "addDiagram") {
      const frameTempId = allocator.allocate();
      const rawNodes = action.nodes.map((node) => ({
        logicalKey: `${action.key}/${node.key}`,
        tempId: allocator.allocate(),
        nodeType: nativeNodeType(node.shape),
        position: { x: 0, y: 0 },
        size: estimatedNodeSize({
          title: node.label,
          ...(node.detail !== undefined ? { body: node.detail } : {}),
          baseWidth: 260,
          baseHeight: node.detail ? 160 : 120,
        }),
        content: { title: node.label, ...(node.detail !== undefined ? { body: node.detail } : {}) },
        appearance: appearanceForTone(node.tone ?? "blue"),
        parentTempId: frameTempId,
      }));
      const childSizes = rawNodes.map((node) => node.size);
      const diagramLayout = normalizeLayout(childSizes, diagramPositions(action, childSizes));
      const positionedChildren = repositionNodes(rawNodes, diagramLayout.positions).map((node) => ({
        ...node,
        position: {
          x: node.position.x + FRAME_PADDING,
          y: node.position.y + FRAME_HEADER + FRAME_PADDING,
        },
      }));
      const frame: GeneratedNode = {
        logicalKey: action.key,
        tempId: frameTempId,
        nodeType: "frame",
        position: { x: 0, y: 0 },
        size: {
          width: diagramLayout.size.width + FRAME_PADDING * 2,
          height: diagramLayout.size.height + FRAME_HEADER + FRAME_PADDING * 2,
        },
        content: { title: action.title ?? "Fabric agent diagram" },
        appearance: { fill: "fog" },
      };
      const keyToTemp = new Map(
        action.nodes.map((node, index) => [node.key, positionedChildren[index]!.tempId]),
      );
      const connectors = action.connections.map((connection) => ({
        tempId: allocator.allocate(),
        sourceTempId: keyToTemp.get(connection.from)!,
        targetTempId: keyToTemp.get(connection.to)!,
        ...(connection.label ? { label: connection.label } : {}),
      }));
      groups.push({
        nodes: [frame, ...positionedChildren],
        connectors,
        size: frame.size,
      });
      continue;
    }

    if (action.kind === "arrangeSelection") {
      const selected = action.selectionRefs.map((reference) => selectedNode(input.scene, reference));
      selected.forEach((node) => requireMutation(node, "move"));
      const selectedHandles = new Set(action.selectionRefs);
      const nodeByHandle = new Map(input.scene.nodes.map((node) => [node.handle, node]));
      for (const node of selected) {
        let parentHandle = node.parentHandle;
        while (parentHandle) {
          if (selectedHandles.has(parentHandle)) {
            throw new BoardPlanCompileError(
              "layout_failed",
              "Nested parent and child objects must be arranged in separate proposals.",
            );
          }
          parentHandle = nodeByHandle.get(parentHandle)?.parentHandle;
        }
      }
      if (selected.some((node) => movementByNode.has(node.id))) {
        throw new BoardPlanCompileError(
          "duplicate_mutation",
          "A selected object cannot be arranged more than once in one proposal.",
        );
      }
      const gap = action.spacing === "compact" ? 24 : action.spacing === "spacious" ? 80 : 48;
      const sizes = selected.map((node) => ({
        width: node.bounds.width,
        height: node.bounds.height,
      }));
      const arrangement = normalizeLayout(
        sizes,
        arrangedPositions(selected, action.arrangement, gap),
      );
      const selectedIds = new Set(selected.map((node) => node.id));
      const obstacles = input.scene.nodes
        .filter((node) => !selectedIds.has(node.id))
        .map((node) => plannedMovementBounds.get(node.id) ?? node.bounds);
      const start = input.scene.selectionBounds
        ? { x: input.scene.selectionBounds.x, y: input.scene.selectionBounds.y }
        : { x: input.scene.viewport.x + 40, y: input.scene.viewport.y + 40 };
      const origin = freeOrigin({
        desired: start,
        size: arrangement.size,
        obstacles,
      });
      selected.forEach((node, index) => {
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
        const node = selectedNode(input.scene, edit.selectionRef);
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
      const node = selectedNode(input.scene, reference);
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
    : linearPositions(groupSizes, input.proposal.flow);
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
        route: "elbow",
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
