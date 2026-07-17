import { describe, expect, it } from "vitest";

import type { CanvasNode } from "../../types";
import {
  AuthorizedBoardSceneSchema,
  buildAuthorizedModelScene,
  buildAuthorizedBoardScene,
  MAX_AUTHORIZED_SCENE_NODES,
  MAX_AUTHORIZED_WRITABLE_NODES,
  MAX_MODEL_SCENE_BYTES,
  modelSceneContext,
} from "./authorized-scene";

function node(id: string, x: number, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: "note",
    title: id,
    x,
    y: 10,
    width: 100,
    height: 80,
    fill: "yellow",
    ...overrides,
  };
}

describe("authorized board scene", () => {
  it("adds visible durable context without granting write authority", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [node("chosen", 10), node("nearby", 160), node("outside", 2_000)],
        edges: [
          { id: "edge-1", sourceId: "chosen", targetId: "nearby", route: "straight" },
        ],
      },
      selection: [
        {
          id: "chosen",
          type: "note",
          title: "untrusted browser title",
          x: 999,
          y: 999,
          width: 1,
          height: 1,
        },
      ],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes).toEqual([
      expect.objectContaining({
        id: "chosen",
        handle: "s1",
        role: "selected",
        writable: true,
        allowedMutations: ["move", "resize", "content", "style"],
        title: "chosen",
        bounds: { x: 10, y: 10, width: 100, height: 80 },
      }),
      expect.objectContaining({
        id: "nearby",
        handle: "v1",
        role: "visible",
        writable: false,
      }),
    ]);
    expect(scene.edges).toEqual([
      { sourceHandle: "s1", targetHandle: "v1", route: "straight" },
    ]);
    expect(scene.writableHandles).toEqual(["s1"]);
  });

  it("authorizes durable unlocked nodes fully inside an empty-selection viewport", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("visible", 10)], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes).toEqual([
      expect.objectContaining({
        handle: "v1",
        role: "visible",
        writable: true,
        allowedMutations: ["move", "resize", "content", "style"],
      }),
    ]);
    expect(scene.writableHandles).toEqual(["v1"]);
    expect(scene.selectionBounds).toBeUndefined();
  });

  it("keeps partial, locked, and out-of-viewport durable nodes outside write scope", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          node("inside", 120),
          node("partial", -50),
          node("locked", 260, { locked: true }),
          node("outside", 900),
        ],
        edges: [],
      },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes.map((item) => item.id)).not.toContain("outside");
    expect(scene.nodes.find((item) => item.id === "inside")).toEqual(
      expect.objectContaining({ writable: true }),
    );
    expect(scene.nodes.find((item) => item.id === "partial")).toEqual(
      expect.objectContaining({ writable: false, allowedMutations: [] }),
    );
    expect(scene.nodes.find((item) => item.id === "locked")).toEqual(
      expect.objectContaining({ writable: false, allowedMutations: [], locked: true }),
    );
    expect(scene.writableHandles).toEqual([
      scene.nodes.find((item) => item.id === "inside")!.handle,
    ]);
  });

  it("keeps locked descendants and children with omitted parents read-only", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          node("locked-parent", 20, {
            type: "frame",
            locked: true,
            width: 300,
            height: 220,
          }),
          node("locked-child", 60, { parentId: "locked-parent" }),
          node("partial-parent", -500, { width: 100, height: 100 }),
          node("orphaned-visible-child", 120, { parentId: "partial-parent" }),
        ],
        edges: [],
      },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes.find((item) => item.id === "locked-child")).toMatchObject({
      locked: true,
      writable: false,
      allowedMutations: [],
    });
    expect(scene.nodes.find((item) => item.id === "orphaned-visible-child")).toMatchObject({
      writable: false,
      allowedMutations: [],
    });
  });

  it("does not authorize container movement when durable descendants are omitted", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          node("frame", 20, {
            type: "frame",
            width: 300,
            height: 220,
            hasDescendants: true,
          }),
          node("offscreen-child", 2_000, { parentId: "frame" }),
        ],
        edges: [],
      },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes.map((item) => item.id)).toEqual(["frame"]);
    expect(scene.nodes[0]).toMatchObject({
      writable: true,
      allowedMutations: ["content", "style"],
    });
  });

  it("caps viewport write scope nearest-first without hiding additional context", () => {
    const nodes = Array.from({ length: MAX_AUTHORIZED_WRITABLE_NODES + 8 }, (_, index) =>
      node(`visible-${String(index).padStart(2, "0")}`, 1_000 + index * 2),
    );
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes, edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 4_000, height: 400 },
    });

    expect(scene.nodes).toHaveLength(nodes.length);
    expect(scene.writableHandles).toHaveLength(MAX_AUTHORIZED_WRITABLE_NODES);
    expect(scene.nodes.filter((item) => !item.writable)).toHaveLength(8);
    expect(scene.writableHandles).toEqual(
      scene.nodes.slice(0, MAX_AUTHORIZED_WRITABLE_NODES).map((item) => item.handle),
    );
  });

  it("rejects persisted write authority for a partially visible node", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("partial", -50)], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });
    const forged = {
      ...scene,
      nodes: scene.nodes.map((item) => ({
        ...item,
        writable: true,
        allowedMutations: ["move"],
      })),
      writableHandles: ["v1"],
    };

    expect(AuthorizedBoardSceneSchema.safeParse(forged).success).toBe(false);
  });

  it("rejects persisted write authority for locked nodes and image content", () => {
    const lockedScene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("locked", 100, { locked: true })], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });
    const forgedLocked = {
      ...lockedScene,
      nodes: lockedScene.nodes.map((item) => ({
        ...item,
        writable: true,
        allowedMutations: ["move"],
      })),
      writableHandles: ["v1"],
    };
    expect(AuthorizedBoardSceneSchema.safeParse(forgedLocked).success).toBe(false);

    const imageScene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("image", 100, { type: "image" })], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });
    const forgedImage = {
      ...imageScene,
      nodes: imageScene.nodes.map((item) => ({
        ...item,
        allowedMutations: ["move", "content"],
      })),
    };
    expect(AuthorizedBoardSceneSchema.safeParse(forgedImage).success).toBe(false);
  });

  it("never exposes durable node identifiers to the provider context", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("secret-node-id", 10, { title: "Visible note" })], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    const context = modelSceneContext(scene) as {
      nodes: Array<{ handle: string; writable: boolean; allowedMutations: string[] }>;
      writableHandles: string[];
    };
    const providerContext = JSON.stringify(context);
    expect(providerContext).not.toContain("secret-node-id");
    expect(providerContext).toContain('"handle":"v1"');
    expect(context.nodes[0]).toMatchObject({
      handle: "v1",
      writable: true,
      allowedMutations: ["move", "resize", "content", "style"],
    });
    expect(context.writableHandles).toEqual(["v1"]);
  });

  it("is deterministic and reports bounded truncation", () => {
    const nodes = Array.from({ length: MAX_AUTHORIZED_SCENE_NODES + 7 }, (_, index) =>
      node(`node-${String(index).padStart(3, "0")}`, index),
    );
    const input = {
      snapshot: { nodes, edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 1_000, height: 400 },
    } as const;

    const first = buildAuthorizedBoardScene(input);
    const second = buildAuthorizedBoardScene(input);
    expect(first).toEqual(second);
    expect(first.nodes).toHaveLength(MAX_AUTHORIZED_SCENE_NODES);
    expect(first.truncated.nodes).toBe(7);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps selected image and drawing content immutable while allowing geometry changes", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          node("image", 10, { type: "image" }),
          node("drawing", 130, { type: "drawing" }),
        ],
        edges: [],
      },
      selection: [
        { id: "image", type: "image", title: "Image", x: 10, y: 10, width: 100, height: 80 },
        { id: "drawing", type: "drawing", title: "Drawing", x: 130, y: 10, width: 100, height: 80 },
      ],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes).toEqual([
      expect.objectContaining({
        type: "drawing",
        allowedMutations: ["move", "resize"],
      }),
      expect.objectContaining({
        type: "image",
        allowedMutations: ["move", "resize"],
      }),
    ]);
    expect(scene.writableHandles).toEqual(["s1", "s2"]);
  });

  it("keeps the complete model scene under one deterministic global byte budget", () => {
    const nodes = Array.from({ length: MAX_AUTHORIZED_SCENE_NODES }, (_, index) =>
      node(`node-${String(index).padStart(3, "0")}`, index * 8, {
        title: `Node ${index} ${"title ".repeat(24)}`,
        body: `${index}: ${"context ".repeat(500)}`,
      }),
    );
    const selected = nodes.slice(0, 40).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      body: item.body,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    }));
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes, edges: [] },
      selection: selected,
      viewport: { x: 0, y: 0, width: 1_000, height: 400 },
    });

    const first = modelSceneContext(scene) as {
      nodes: Array<{ role: string }>;
      truncated: { textCharacters: number };
    };
    const second = modelSceneContext(scene);
    expect(first).toEqual(second);
    expect(first.nodes.filter((entry) => entry.role === "selected")).toHaveLength(40);
    expect(first.truncated.textCharacters).toBeGreaterThan(0);
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(
      MAX_MODEL_SCENE_BYTES,
    );
  });

  it("downgrades writable handles omitted from the bounded provider context", () => {
    const nodes = Array.from({ length: 25 }, (_, index) =>
      node(`visible-${String(index).padStart(2, "0")}`, 40 + index * 120, {
        body: `${index}: ${"large visible context ".repeat(220)}`,
      }),
    );
    const durableScene = buildAuthorizedBoardScene({
      snapshot: { nodes, edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 4_000, height: 500 },
    });

    expect(durableScene.writableHandles).toHaveLength(25);
    const authorized = buildAuthorizedModelScene(durableScene);
    const context = authorized.context as {
      nodes: Array<{ handle: string; writable: boolean }>;
      writableHandles: string[];
      truncated: { nodes: number; textCharacters: number };
    };
    const exposedHandles = context.nodes.map((item) => item.handle);

    expect(context.nodes).toHaveLength(20);
    expect(context.truncated.nodes).toBe(5);
    expect(context.truncated.textCharacters).toBeGreaterThan(0);
    expect(context.writableHandles).toEqual(exposedHandles);
    expect(authorized.scene.writableHandles).toEqual(context.writableHandles);
    expect(authorized.scene.nodes.find((item) => item.handle === "v21")).toMatchObject({
      writable: false,
      allowedMutations: [],
    });
    expect(AuthorizedBoardSceneSchema.safeParse(authorized.scene).success).toBe(true);
  });
});
