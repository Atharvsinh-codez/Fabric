import { z } from "zod";

import {
  CanvasIdentifierSchema,
  CanvasNodeTypeSchema,
  CanvasSourceGeometrySchema,
} from "../canvas-patch";
import { hashCanonicalJson } from "../hash";
import type { ProposalNodeSnapshot } from "../proposal-request";
import type { CanvasEdge, CanvasNode } from "../../types";

export const AUTHORIZED_SCENE_VERSION = 1 as const;
export const MAX_AUTHORIZED_SCENE_NODES = 80;
export const MAX_AUTHORIZED_SCENE_EDGES = 160;
export const MAX_AUTHORIZED_WRITABLE_NODES = 40;
export const MAX_MODEL_SCENE_BYTES = 24_000;
const MAX_MODEL_VISIBLE_NODES = 20;
const MAX_MODEL_TITLE_CHARACTERS = 120;
const MAX_MODEL_SELECTED_BODY_CHARACTERS = 480;
const MAX_MODEL_VISIBLE_BODY_CHARACTERS = 120;

const SceneCoordinateSchema = z.number().finite().min(-100_000).max(100_000);
const SceneDimensionSchema = z.number().finite().min(1).max(10_000);
const SceneHandleSchema = z
  .string()
  .regex(/^[sv][1-9][0-9]{0,2}$/, "Invalid authorized scene handle");
const SceneMutationSchema = z.enum(["move", "resize", "content", "style"]);

export const SceneBoundsSchema = z
  .object({
    x: SceneCoordinateSchema,
    y: SceneCoordinateSchema,
    width: SceneDimensionSchema,
    height: SceneDimensionSchema,
  })
  .strict();

export const AuthorizedSceneNodeSchema = z
  .object({
    id: CanvasIdentifierSchema,
    handle: SceneHandleSchema,
    role: z.enum(["selected", "visible"]),
    writable: z.boolean(),
    allowedMutations: z.array(SceneMutationSchema).max(4),
    type: CanvasNodeTypeSchema,
    title: z.string().trim().min(1).max(200),
    body: z.string().max(4_000).optional(),
    bounds: SceneBoundsSchema,
    locked: z.boolean(),
    fill: z.string().trim().min(1).max(64),
    textColor: z.string().trim().min(1).max(64).optional(),
    parentHandle: SceneHandleSchema.optional(),
    tag: z.string().trim().min(1).max(64).optional(),
    source: CanvasSourceGeometrySchema.optional(),
  })
  .strict()
  .superRefine((node, context) => {
    if (new Set(node.allowedMutations).size !== node.allowedMutations.length) {
      context.addIssue({
        code: "custom",
        message: "Allowed mutations must be unique",
        path: ["allowedMutations"],
      });
    }
    if (node.writable !== (node.allowedMutations.length > 0)) {
      context.addIssue({
        code: "custom",
        message: "Write authority must match the allowed mutation set",
        path: ["allowedMutations"],
      });
    }
    if (node.locked && node.writable) {
      context.addIssue({
        code: "custom",
        message: "Locked nodes cannot receive write authority",
        path: ["writable"],
      });
    }
    if (
      (node.type === "image" || node.type === "drawing") &&
      node.allowedMutations.some((mutation) => mutation === "content" || mutation === "style")
    ) {
      context.addIssue({
        code: "custom",
        message: "Image and drawing content cannot be replaced through scene mutations",
        path: ["allowedMutations"],
      });
    }
    if (node.source && (node.role !== "selected" || node.type !== "drawing")) {
      context.addIssue({
        code: "custom",
        message: "Only selected drawings may include vector source geometry",
        path: ["source"],
      });
    }
  });

export const AuthorizedSceneEdgeSchema = z
  .object({
    sourceHandle: SceneHandleSchema,
    targetHandle: SceneHandleSchema,
    route: z.enum(["straight", "elbow"]),
  })
  .strict();

export const AuthorizedBoardSceneSchema = z
  .object({
    version: z.literal(AUTHORIZED_SCENE_VERSION),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    viewport: SceneBoundsSchema,
    selectionBounds: SceneBoundsSchema.optional(),
    nodes: z.array(AuthorizedSceneNodeSchema).max(MAX_AUTHORIZED_SCENE_NODES),
    edges: z.array(AuthorizedSceneEdgeSchema).max(MAX_AUTHORIZED_SCENE_EDGES),
    writableHandles: z.array(SceneHandleSchema).max(MAX_AUTHORIZED_WRITABLE_NODES),
    truncated: z
      .object({
        nodes: z.number().int().nonnegative(),
        edges: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((scene, context) => {
    const handles = new Set(scene.nodes.map((node) => node.handle));
    if (handles.size !== scene.nodes.length) {
      context.addIssue({
        code: "custom",
        message: "Authorized scene handles must be unique",
        path: ["nodes"],
      });
    }
    const writableHandles = scene.nodes
      .filter((node) => node.writable)
      .map((node) => node.handle);
    const writable = new Set(writableHandles);
    for (const [index, handle] of scene.writableHandles.entries()) {
      if (!writable.has(handle)) {
        context.addIssue({
          code: "custom",
          message: "Writable handles must reference authorized writable nodes",
          path: ["writableHandles", index],
        });
      }
    }
    if (
      writableHandles.length !== scene.writableHandles.length ||
      writableHandles.some((handle, index) => scene.writableHandles[index] !== handle)
    ) {
      context.addIssue({
        code: "custom",
        message: "Writable handles must exactly match writable scene nodes",
        path: ["writableHandles"],
      });
    }
    scene.nodes.forEach((node, index) => {
      if (
        node.role === "visible" &&
        node.writable &&
        !contains(scene.viewport, node.bounds)
      ) {
        context.addIssue({
          code: "custom",
          message: "Writable visible nodes must be fully contained in the authorized viewport",
          path: ["nodes", index, "bounds"],
        });
      }
    });
    for (const [index, edge] of scene.edges.entries()) {
      if (!handles.has(edge.sourceHandle) || !handles.has(edge.targetHandle)) {
        context.addIssue({
          code: "custom",
          message: "Scene edges must reference included nodes",
          path: ["edges", index],
        });
      }
    }
  });

export type SceneBounds = z.infer<typeof SceneBoundsSchema>;
export type AuthorizedSceneNode = z.infer<typeof AuthorizedSceneNodeSchema>;
export type AuthorizedBoardScene = z.infer<typeof AuthorizedBoardSceneSchema>;

type SceneSnapshot = Readonly<{
  nodes: readonly CanvasNode[];
  edges: readonly CanvasEdge[];
}>;

function intersects(left: SceneBounds, right: SceneBounds): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function contains(container: SceneBounds, item: SceneBounds): boolean {
  return (
    item.x >= container.x &&
    item.y >= container.y &&
    item.x + item.width <= container.x + container.width &&
    item.y + item.height <= container.y + container.height
  );
}

function nodeBounds(node: Pick<CanvasNode, "x" | "y" | "width" | "height">): SceneBounds {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function distanceFromViewportCenter(node: CanvasNode, viewport: SceneBounds): number {
  const dx = node.x + node.width / 2 - (viewport.x + viewport.width / 2);
  const dy = node.y + node.height / 2 - (viewport.y + viewport.height / 2);
  return dx * dx + dy * dy;
}

function combinedBounds(nodes: readonly CanvasNode[]): SceneBounds | undefined {
  if (nodes.length === 0) return undefined;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function nodeOrAncestorLocked(
  node: CanvasNode,
  nodeById: ReadonlyMap<string, CanvasNode>,
): boolean {
  let current: CanvasNode | undefined = node;
  const visited = new Set<string>();
  while (current) {
    if (current.locked === true) return true;
    if (!current.parentId) return false;
    if (visited.has(current.id) || visited.size >= 32) return true;
    visited.add(current.id);
    current = nodeById.get(current.parentId);
    if (!current) return true;
  }
  return true;
}

function contentForNode(
  node: CanvasNode,
  bodyLimit: number,
): Pick<AuthorizedSceneNode, "title" | "body" | "tag"> {
  return {
    title: node.title.trim() || "Untitled",
    ...(node.body !== undefined ? { body: node.body.slice(0, bodyLimit) } : {}),
    ...(node.tag !== undefined ? { tag: node.tag } : {}),
  };
}

export function buildAuthorizedBoardScene(input: {
  snapshot: SceneSnapshot;
  selection: readonly ProposalNodeSnapshot[];
  viewport: SceneBounds;
}): AuthorizedBoardScene {
  const selectedById = new Map(input.selection.map((node) => [node.id, node]));
  const selectedNodes = input.snapshot.nodes
    .filter((node) => selectedById.has(node.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const visibleCandidates = input.snapshot.nodes
    .filter((node) => !selectedIds.has(node.id) && intersects(nodeBounds(node), input.viewport))
    .sort((left, right) => {
      const distance =
        distanceFromViewportCenter(left, input.viewport) -
        distanceFromViewportCenter(right, input.viewport);
      return distance || left.id.localeCompare(right.id);
    });
  const visibleLimit = Math.max(0, MAX_AUTHORIZED_SCENE_NODES - selectedNodes.length);
  const visibleNodes = visibleCandidates.slice(0, visibleLimit);
  const snapshotNodeById = new Map(input.snapshot.nodes.map((node) => [node.id, node]));
  const includedNodeIds = new Set([...selectedNodes, ...visibleNodes].map((node) => node.id));
  // With the selection UX removed, the requested viewport becomes the only
  // browser-provided mutation scope. The browser still supplies no node data:
  // candidates are rebuilt from the current durable snapshot, must be fully
  // visible, unlocked, and are capped nearest-first. Partially visible nodes
  // remain useful read-only context and collision obstacles.
  const viewportWritableIds = new Set(
    input.selection.length === 0
      ? visibleNodes
          .filter((node) =>
            !nodeOrAncestorLocked(node, snapshotNodeById) &&
            node.viewportWriteSafe !== false &&
            (!node.parentId || includedNodeIds.has(node.parentId)) &&
            contains(input.viewport, nodeBounds(node)),
          )
          .slice(0, MAX_AUTHORIZED_WRITABLE_NODES)
          .map((node) => node.id)
      : [],
  );
  const includedNodes = [...selectedNodes, ...visibleNodes];
  const containerIds = new Set(
    input.snapshot.nodes.flatMap((node) => [
      ...(node.parentId ? [node.parentId] : []),
      ...(node.hasDescendants ? [node.id] : []),
    ]),
  );
  const handleById = new Map<string, string>();
  selectedNodes.forEach((node, index) => handleById.set(node.id, `s${index + 1}`));
  visibleNodes.forEach((node, index) => handleById.set(node.id, `v${index + 1}`));

  const nodes: AuthorizedSceneNode[] = includedNodes.map((node) => {
    const selected = selectedIds.has(node.id);
    const locked = nodeOrAncestorLocked(node, snapshotNodeById);
    const writable = !locked && (selected || viewportWritableIds.has(node.id));
    const allowedMutations = !writable
      ? []
      : containerIds.has(node.id)
        ? ["content", "style"] as const
      : node.type === "image" || node.type === "drawing"
        ? ["move", "resize"] as const
        : ["move", "resize", "content", "style"] as const;
    const selectedSource = selectedById.get(node.id)?.source;
    const parentHandle = node.parentId ? handleById.get(node.parentId) : undefined;
    return {
      id: node.id,
      handle: handleById.get(node.id)!,
      role: selected ? "selected" : "visible",
      writable: allowedMutations.length > 0,
      allowedMutations: [...allowedMutations],
      type: node.type,
      ...contentForNode(node, selected ? 1_600 : 600),
      bounds: nodeBounds(node),
      locked,
      fill: node.fill,
      ...(node.textColor !== undefined ? { textColor: node.textColor } : {}),
      ...(parentHandle ? { parentHandle } : {}),
      ...(selectedSource ? { source: selectedSource } : {}),
    };
  });

  const allIncludedEdges = input.snapshot.edges
    .filter((edge) => handleById.has(edge.sourceId) && handleById.has(edge.targetId))
    .sort((left, right) => {
      const source = left.sourceId.localeCompare(right.sourceId);
      return source || left.targetId.localeCompare(right.targetId) || left.id.localeCompare(right.id);
    });
  const edges = allIncludedEdges.slice(0, MAX_AUTHORIZED_SCENE_EDGES).map((edge) => ({
    sourceHandle: handleById.get(edge.sourceId)!,
    targetHandle: handleById.get(edge.targetId)!,
    route: edge.route,
  }));
  const writableHandles = nodes
    .filter((node) => node.writable)
    .map((node) => node.handle);
  const payload = {
    version: AUTHORIZED_SCENE_VERSION,
    viewport: input.viewport,
    ...(selectedNodes.length > 0 ? { selectionBounds: combinedBounds(selectedNodes) } : {}),
    nodes,
    edges,
    writableHandles,
    truncated: {
      nodes: Math.max(0, visibleCandidates.length - visibleNodes.length),
      edges: Math.max(0, allIncludedEdges.length - edges.length),
    },
  } as const;
  return AuthorizedBoardSceneSchema.parse({
    ...payload,
    hash: hashCanonicalJson(payload),
  });
}

/** Backward-compatible context for a job queued before durable scene v1 existed. */
export function buildSelectionOnlyAuthorizedScene(input: {
  selection: readonly ProposalNodeSnapshot[];
  viewport: SceneBounds;
}): AuthorizedBoardScene {
  return buildAuthorizedBoardScene({
    snapshot: {
      nodes: input.selection.map((node) => ({
        id: node.id,
        type: node.type,
        title: node.title,
        ...(node.body !== undefined ? { body: node.body } : {}),
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fill: "#eef3f8",
        ...(node.locked !== undefined ? { locked: node.locked } : {}),
        ...(node.parentId !== undefined ? { parentId: node.parentId } : {}),
        ...(node.tag !== undefined ? { tag: node.tag } : {}),
      })),
      edges: [],
    },
    selection: input.selection,
    viewport: input.viewport,
  });
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function modelNode(
  node: AuthorizedSceneNode,
  body: string | undefined,
): Record<string, unknown> {
  return {
    handle: node.handle,
    role: node.role,
    writable: node.writable,
    allowedMutations: node.allowedMutations,
    type: node.type,
    title: node.title.slice(0, MAX_MODEL_TITLE_CHARACTERS),
    ...(body !== undefined && body.length > 0 ? { body } : {}),
    bounds: node.bounds,
    locked: node.locked,
    fill: node.fill,
    ...(node.textColor !== undefined ? { textColor: node.textColor } : {}),
    ...(node.parentHandle !== undefined ? { parentHandle: node.parentHandle } : {}),
    ...(node.tag !== undefined ? { tag: node.tag } : {}),
    ...(node.source ? { hasVisualSource: true } : {}),
    ...(node.type === "image"
      ? { visualEvidence: "exact-media-if-attached" }
      : node.type === "drawing"
        ? {
            visualEvidence: node.source
              ? "scene-preview"
              : "unavailable-unless-exact-media-attached",
          }
        : {}),
  };
}

function modelScenePayload(input: {
  scene: AuthorizedBoardScene;
  nodes: readonly AuthorizedSceneNode[];
  edges: readonly AuthorizedBoardScene["edges"][number][];
  bodies: ReadonlyMap<string, string>;
}): Record<string, unknown> {
  const includedHandles = new Set(input.nodes.map((node) => node.handle));
  const sourceTextCharacters = input.scene.nodes.reduce(
    (total, node) => total + node.title.length + (node.body?.length ?? 0) + (node.tag?.length ?? 0),
    0,
  );
  const transmittedTextCharacters = input.nodes.reduce(
    (total, node) =>
      total +
      Math.min(node.title.length, MAX_MODEL_TITLE_CHARACTERS) +
      (input.bodies.get(node.handle)?.length ?? 0) +
      (node.tag?.length ?? 0),
    0,
  );
  return {
    version: input.scene.version,
    viewport: input.scene.viewport,
    ...(input.scene.selectionBounds ? { selectionBounds: input.scene.selectionBounds } : {}),
    nodes: input.nodes.map((node) => modelNode(node, input.bodies.get(node.handle))),
    edges: input.edges,
    writableHandles: input.scene.writableHandles.filter((handle) => includedHandles.has(handle)),
    truncated: {
      nodes: input.scene.truncated.nodes + input.scene.nodes.length - input.nodes.length,
      edges: input.scene.truncated.edges + input.scene.edges.length - input.edges.length,
      textCharacters: Math.max(0, sourceTextCharacters - transmittedTextCharacters),
    },
  };
}

function addBodiesWithinBudget(input: {
  scene: AuthorizedBoardScene;
  nodes: readonly AuthorizedSceneNode[];
  edges: readonly AuthorizedBoardScene["edges"][number][];
  bodies: Map<string, string>;
  candidates: readonly AuthorizedSceneNode[];
  perNodeLimit: number;
  increment: number;
}): void {
  const blocked = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of input.candidates) {
      if (!node.body || blocked.has(node.handle)) continue;
      const current = input.bodies.get(node.handle) ?? "";
      const nextLength = Math.min(node.body.length, input.perNodeLimit, current.length + input.increment);
      if (nextLength <= current.length) continue;
      input.bodies.set(node.handle, node.body.slice(0, nextLength));
      const candidate = modelScenePayload(input);
      if (jsonBytes(candidate) <= MAX_MODEL_SCENE_BYTES) {
        changed = true;
      } else {
        if (current.length > 0) input.bodies.set(node.handle, current);
        else input.bodies.delete(node.handle);
        blocked.add(node.handle);
      }
    }
  }
}

/**
 * The provider receives opaque handles and semantic context, never durable
 * Fabric node identifiers or write authority inferred from visibility. The
 * model view has a deterministic global byte budget: legacy selected objects
 * and their text are retained first, followed by nearest visible objects,
 * edges, and finally bounded visible body text. Write authority always comes
 * from writableHandles, never from a role or from visibility alone.
 */
function buildModelSceneProjection(scene: AuthorizedBoardScene): {
  context: Record<string, unknown>;
  includedHandles: ReadonlySet<string>;
} {
  const selected = scene.nodes.filter((node) => node.role === "selected");
  const visible = scene.nodes
    .filter((node) => node.role === "visible")
    .slice(0, MAX_MODEL_VISIBLE_NODES);
  const includedNodes: AuthorizedSceneNode[] = [...selected];
  const includedEdges: AuthorizedBoardScene["edges"][number][] = [];
  const bodies = new Map<string, string>();

  addBodiesWithinBudget({
    scene,
    nodes: includedNodes,
    edges: includedEdges,
    bodies,
    candidates: selected,
    perNodeLimit: MAX_MODEL_SELECTED_BODY_CHARACTERS,
    increment: 80,
  });

  for (const node of visible) {
    const candidateNodes = [...includedNodes, node];
    if (jsonBytes(modelScenePayload({ scene, nodes: candidateNodes, edges: includedEdges, bodies })) >
      MAX_MODEL_SCENE_BYTES) break;
    includedNodes.push(node);
  }

  const handles = new Set(includedNodes.map((node) => node.handle));
  for (const edge of scene.edges) {
    if (!handles.has(edge.sourceHandle) || !handles.has(edge.targetHandle)) continue;
    const candidateEdges = [...includedEdges, edge];
    if (jsonBytes(modelScenePayload({ scene, nodes: includedNodes, edges: candidateEdges, bodies })) >
      MAX_MODEL_SCENE_BYTES) break;
    includedEdges.push(edge);
  }

  addBodiesWithinBudget({
    scene,
    nodes: includedNodes,
    edges: includedEdges,
    bodies,
    candidates: includedNodes.filter((node) => node.role === "visible"),
    perNodeLimit: MAX_MODEL_VISIBLE_BODY_CHARACTERS,
    increment: 40,
  });

  const payload = modelScenePayload({ scene, nodes: includedNodes, edges: includedEdges, bodies });
  if (jsonBytes(payload) > MAX_MODEL_SCENE_BYTES) {
    throw new Error("Authorized model scene exceeded its deterministic byte budget");
  }
  return { context: payload, includedHandles: handles };
}

function restrictWriteScopeToModelContext(
  scene: AuthorizedBoardScene,
  includedHandles: ReadonlySet<string>,
): AuthorizedBoardScene {
  const exposedWritableHandles = scene.writableHandles.filter((handle) =>
    includedHandles.has(handle),
  );
  const exposedWritable = new Set(exposedWritableHandles);
  const nodes = scene.nodes.map((node) =>
    node.writable && !exposedWritable.has(node.handle)
      ? { ...node, writable: false, allowedMutations: [] }
      : node,
  );
  const payload = {
    version: scene.version,
    viewport: scene.viewport,
    ...(scene.selectionBounds ? { selectionBounds: scene.selectionBounds } : {}),
    nodes,
    edges: scene.edges,
    writableHandles: exposedWritableHandles,
    truncated: scene.truncated,
  } as const;
  return AuthorizedBoardSceneSchema.parse({
    ...payload,
    hash: hashCanonicalJson(payload),
  });
}

/**
 * Couples the exact provider-visible scene with the authority used by the
 * deterministic compiler. Handles omitted by the model node/count/byte
 * budgets remain collision context, but are downgraded to read-only before a
 * provider response is compiled. This makes a hallucinated omitted handle
 * fail closed instead of inheriting broader durable-scene authority.
 */
export function buildAuthorizedModelScene(scene: AuthorizedBoardScene): {
  context: object;
  scene: AuthorizedBoardScene;
} {
  const projection = buildModelSceneProjection(scene);
  return {
    context: projection.context,
    scene: restrictWriteScopeToModelContext(scene, projection.includedHandles),
  };
}

export function modelSceneContext(scene: AuthorizedBoardScene): object {
  return buildAuthorizedModelScene(scene).context;
}
