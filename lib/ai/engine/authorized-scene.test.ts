import { describe, expect, it } from "vitest";

import type { CanvasNode } from "../../types";
import {
  buildAuthorizedBoardScene,
  MAX_AUTHORIZED_SCENE_NODES,
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

  it("treats an empty selection as read-only visible canvas context", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("visible", 10)], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    expect(scene.nodes).toEqual([
      expect.objectContaining({ handle: "v1", role: "visible", writable: false }),
    ]);
    expect(scene.writableHandles).toEqual([]);
    expect(scene.selectionBounds).toBeUndefined();
  });

  it("never exposes durable node identifiers to the provider context", () => {
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [node("secret-node-id", 10, { title: "Visible note" })], edges: [] },
      selection: [],
      viewport: { x: 0, y: 0, width: 500, height: 400 },
    });

    const providerContext = JSON.stringify(modelSceneContext(scene));
    expect(providerContext).not.toContain("secret-node-id");
    expect(providerContext).toContain('"handle":"v1"');
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
});
