import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardDocument } from "../db/schema/product";
import type { AiProposalRequest } from "../lib/ai/proposal-request";
import { buildAuthorizedBoardScene } from "../lib/ai/engine/authorized-scene";

import type { WorkerSql } from "./database";
import type { ClaimedAiJob } from "./repository";

const mocks = vi.hoisted(() => ({
  issueAiMediaToken: vi.fn(),
}));

vi.mock("../lib/ai/media-token", () => ({
  issueAiMediaToken: mocks.issueAiMediaToken,
}));

import { buildAiModelImages } from "./media-context";

const boardId = "22222222-2222-4222-8222-222222222222";
const runId = "11111111-1111-4111-8111-111111111111";
const documentGenerationId = "33333333-3333-4333-8333-333333333333";
const selectionHash = "c".repeat(64);
const media = {
  baseUrl: "https://fabric.example.test",
  signingKey: "production-media-signing-secret-with-independent-entropy",
};

const job = {
  runId,
  boardId,
  documentGenerationId,
  selectionHash,
} as ClaimedAiJob;

const baseRequest: AiProposalRequest = {
  skill: "canvas-agent",
  workspaceId: "workspace-1",
  boardId,
  documentGenerationId,
  durableSequence: 12,
  instruction: "Explain the selection",
  selection: [],
  viewport: { x: 0, y: 0, width: 1_000, height: 800 },
  conversation: [],
};

function imageShape(input: {
  shapeId: string;
  nodeId: string;
  assetId: string;
  index: string;
}) {
  return {
    id: input.shapeId,
    typeName: "shape",
    type: "image",
    x: 0,
    y: 0,
    rotation: 0,
    index: input.index,
    parentId: "page:main",
    isLocked: false,
    opacity: 1,
    props: { assetId: input.assetId, w: 320, h: 180 },
    meta: { fabric: { nodeId: input.nodeId } },
  };
}

function canvasImageNode(id: string, x: number) {
  return {
    id,
    type: "image" as const,
    title: id,
    x,
    y: 20,
    width: 160,
    height: 100,
    fill: "#ffffff",
  };
}

function selectedDrawing(id: string, x: number, y: number) {
  return {
    id,
    type: "drawing" as const,
    title: id,
    x,
    y,
    width: 240,
    height: 120,
    source: {
      shapeType: "draw" as const,
      segments: [
        {
          type: "free" as const,
          points: [
            { x: 0, y: 10 },
            { x: 80, y: 90 },
            { x: 160, y: 20 },
          ],
        },
      ],
    },
  };
}

function tldrawBoardDocument(
  shapes: readonly ReturnType<typeof imageShape>[],
): BoardDocument {
  return {
    version: 1,
    nodes: [],
    edges: [],
    tldraw: {
      version: 1,
      snapshot: {
        store: Object.fromEntries(shapes.map((shape) => [shape.id, shape])),
        schema: { schemaVersion: 2, sequences: {} },
      },
    },
  };
}

function queryText(strings: TemplateStringsArray): string {
  return strings.join("?").replace(/\s+/gu, " ").trim();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AI model media context", () => {
  it("issues a scene preview capability when visible context exists without a selection", async () => {
    const sql = vi.fn();
    mocks.issueAiMediaToken.mockResolvedValue("scene-capability");
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          {
            id: "visible-note",
            type: "note",
            title: "Visible context",
            x: 10,
            y: 20,
            width: 200,
            height: 120,
            fill: "yellow",
          },
        ],
        edges: [],
      },
      selection: [],
      viewport: baseRequest.viewport,
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: { ...baseRequest, scene },
    });

    expect(sql).not.toHaveBeenCalled();
    expect(images).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/scene-capability",
        label: expect.stringContaining("Authorized scene preview"),
      }),
    ]);
  });

  it("attaches exact pixels for a no-selection visible image through the authorized scene", async () => {
    const authoritativeAssetId = "asset:visible_image";
    const assetStorageId = "55555555-5555-4555-8555-555555555555";
    const contentHash = "b".repeat(64);
    const visibleImage = canvasImageNode("visible-image", 20);
    const document = tldrawBoardDocument([
      imageShape({
        shapeId: "shape:visible-image",
        nodeId: visibleImage.id,
        assetId: authoritativeAssetId,
        index: "a1",
      }),
    ]);
    const observedQueries: Array<{ text: string; values: readonly unknown[] }> = [];
    const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = queryText(strings);
      observedQueries.push({ text, values });
      if (text.includes("from boards")) return [{ document }];
      if (text.includes("from board_assets")) return [{ id: assetStorageId, contentHash }];
      throw new Error(`Unexpected query: ${text}`);
    });
    mocks.issueAiMediaToken
      .mockResolvedValueOnce("scene-capability")
      .mockResolvedValueOnce("visible-asset-capability");
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: [visibleImage], edges: [] },
      selection: [],
      viewport: baseRequest.viewport,
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: { ...baseRequest, scene },
    });

    expect(observedQueries.find((query) => query.text.includes("from boards"))?.values)
      .toEqual([boardId, documentGenerationId]);
    expect(observedQueries.find((query) => query.text.includes("from board_assets"))?.values)
      .toEqual([boardId, authoritativeAssetId]);
    expect(mocks.issueAiMediaToken).toHaveBeenNthCalledWith(2, {
      signingKey: media.signingKey,
      claim: {
        kind: "board-asset",
        runId,
        boardId,
        assetId: assetStorageId,
        contentHash,
      },
    });
    expect(images).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/scene-capability",
        label: expect.stringContaining("attached separately for v1"),
      }),
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/visible-asset-capability",
        label: expect.stringContaining("exact visible board image for scene handle v1"),
        detail: "high",
      }),
    ]);
  });

  it("warns that an unselected drawing placeholder is not exact visual evidence", async () => {
    const sql = vi.fn();
    mocks.issueAiMediaToken.mockResolvedValue("scene-capability");
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          {
            id: "visible-drawing",
            type: "drawing",
            title: "Visible drawing",
            x: 20,
            y: 20,
            width: 160,
            height: 100,
            fill: "#ffffff",
          },
        ],
        edges: [],
      },
      selection: [],
      viewport: baseRequest.viewport,
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: { ...baseRequest, scene },
    });

    expect(sql).not.toHaveBeenCalled();
    expect(images).toEqual([
      expect.objectContaining({
        label: expect.stringContaining(
          "Exact visual source is unavailable for v1; do not infer it; clarify if needed.",
        ),
      }),
    ]);
  });

  it("issues a run- and selection-bound high-resolution crop for vector selections", async () => {
    const sql = vi.fn();
    mocks.issueAiMediaToken.mockResolvedValue("preview-capability");

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: {
        ...baseRequest,
        selection: [
          {
            id: "drawing-1",
            type: "drawing",
            title: "Sketch",
            x: 10,
            y: 20,
            width: 200,
            height: 100,
            source: {
              shapeType: "draw",
              segments: [
                {
                  type: "free",
                  points: [
                    { x: 0, y: 0 },
                    { x: 20, y: 10 },
                  ],
                },
              ],
            },
          },
        ],
      },
    });

    expect(sql).not.toHaveBeenCalled();
    expect(mocks.issueAiMediaToken).toHaveBeenCalledWith({
      signingKey: media.signingKey,
      claim: {
        kind: "selected-drawing-preview",
        runId,
        boardId,
        selectionHash,
      },
    });
    expect(images).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/preview-capability",
        detail: "high",
      }),
    ]);
  });

  it("adds one combined selected-drawing crop when a large scene would make handwriting tiny", async () => {
    const sql = vi.fn();
    mocks.issueAiMediaToken
      .mockResolvedValueOnce("scene-capability")
      .mockResolvedValueOnce("drawing-capability");
    const selected = [
      selectedDrawing("drawing-a", 20, 20),
      selectedDrawing("drawing-b", 320, 20),
    ];
    const visibleNotes = Array.from({ length: 32 }, (_, index) => ({
      id: `context-${String(index).padStart(2, "0")}`,
      type: "note" as const,
      title: `Context ${index + 1}`,
      x: 100 + (index % 8) * 520,
      y: 500 + Math.floor(index / 8) * 500,
      width: 360,
      height: 260,
      fill: "yellow",
    }));
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          ...selected.map((drawing) => ({
            id: drawing.id,
            type: drawing.type,
            title: drawing.title,
            x: drawing.x,
            y: drawing.y,
            width: drawing.width,
            height: drawing.height,
            fill: "#ffffff",
          })),
          ...visibleNotes,
        ],
        edges: [],
      },
      selection: selected,
      viewport: { x: 0, y: 0, width: 5_000, height: 4_000 },
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: {
        ...baseRequest,
        selection: selected,
        viewport: { x: 0, y: 0, width: 5_000, height: 4_000 },
        scene,
      },
    });

    expect(scene.nodes.length).toBeGreaterThan(30);
    expect(sql).not.toHaveBeenCalled();
    expect(mocks.issueAiMediaToken).toHaveBeenNthCalledWith(1, {
      signingKey: media.signingKey,
      claim: { kind: "selection-preview", runId, boardId },
    });
    expect(mocks.issueAiMediaToken).toHaveBeenNthCalledWith(2, {
      signingKey: media.signingKey,
      claim: {
        kind: "selected-drawing-preview",
        runId,
        boardId,
        selectionHash,
      },
    });
    expect(images).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/scene-capability",
      }),
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/drawing-capability",
        label: expect.stringContaining("scene handles s1, s2"),
        detail: "high",
      }),
    ]);
  });

  it("maps a selected image through the authorized board document and exact board asset", async () => {
    const authoritativeAssetId = "asset:authoritative_image";
    const assetStorageId = "44444444-4444-4444-8444-444444444444";
    const contentHash = "a".repeat(64);
    const document = tldrawBoardDocument([
      imageShape({
        shapeId: "shape:selected-image",
        nodeId: "selected-image",
        assetId: authoritativeAssetId,
        index: "a1",
      }),
    ]);
    const observedQueries: Array<{ text: string; values: readonly unknown[] }> = [];
    const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = queryText(strings);
      observedQueries.push({ text, values });
      if (text.includes("from boards")) return [{ document }];
      if (text.includes("from board_assets")) {
        return [{ id: assetStorageId, contentHash }];
      }
      throw new Error(`Unexpected query: ${text}`);
    });
    mocks.issueAiMediaToken
      .mockResolvedValueOnce("scene-capability")
      .mockResolvedValueOnce("asset-capability");
    const selectedImage = {
      id: "selected-image",
      type: "image" as const,
      title: "Client supplied title only",
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    };
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [{ ...selectedImage, fill: "#ffffff" }],
        edges: [],
      },
      selection: [selectedImage],
      viewport: baseRequest.viewport,
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: {
        ...baseRequest,
        selection: [selectedImage],
        scene,
      },
    });

    const boardQuery = observedQueries.find((query) => query.text.includes("from boards"));
    expect(boardQuery?.values).toEqual([boardId, documentGenerationId]);
    const assetQuery = observedQueries.find((query) => query.text.includes("from board_assets"));
    expect(assetQuery?.values).toEqual([boardId, authoritativeAssetId]);
    expect(mocks.issueAiMediaToken).toHaveBeenCalledWith({
      signingKey: media.signingKey,
      claim: {
        kind: "board-asset",
        runId,
        boardId,
        assetId: assetStorageId,
        contentHash,
      },
    });
    expect(images).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/scene-capability",
      }),
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/asset-capability",
        detail: "high",
        label: expect.stringContaining("scene handle s1"),
      }),
    ]);
  });

  it("prioritizes selected image pixels and caps exact authorized media at four", async () => {
    const selected = canvasImageNode("selected-image", 900);
    const visible = Array.from({ length: 4 }, (_, index) =>
      canvasImageNode(`visible-${index + 1}`, 50 + index * 180),
    );
    const allNodes = [selected, ...visible];
    const shapes = allNodes.map((node, index) =>
      imageShape({
        shapeId: `shape:${node.id}`,
        nodeId: node.id,
        assetId: `asset:${node.id}`,
        index: `a${index + 1}`,
      }),
    );
    const document = tldrawBoardDocument(shapes);
    const assetLookups: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = queryText(strings);
      if (text.includes("from boards")) return [{ document }];
      if (text.includes("from board_assets")) {
        assetLookups.push(String(values[1]));
        return [{
          id: `storage-${assetLookups.length}`,
          contentHash: String(assetLookups.length).repeat(64).slice(0, 64),
        }];
      }
      throw new Error(`Unexpected query: ${text}`);
    });
    mocks.issueAiMediaToken.mockImplementation(async (input) => {
      if (input.claim.kind === "selection-preview") return "scene-capability";
      if (input.claim.kind === "selected-drawing-preview") return "drawing-capability";
      return `asset-capability-${input.claim.assetId}`;
    });
    const selectedSnapshot = {
      id: selected.id,
      type: selected.type,
      title: selected.title,
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
    };
    const scene = buildAuthorizedBoardScene({
      snapshot: { nodes: allNodes, edges: [] },
      selection: [selectedSnapshot],
      viewport: baseRequest.viewport,
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: { ...baseRequest, selection: [selectedSnapshot], scene },
    });

    expect(assetLookups).toHaveLength(4);
    expect(assetLookups[0]).toBe("asset:selected-image");
    expect(images).toHaveLength(5);
    expect(images[1]?.label).toContain("exact selected board image for scene handle s1");
  });

  it("caps exact images at three when a scene and selected-drawing crop use two slots", async () => {
    const selectedImage = canvasImageNode("selected-image", 900);
    const drawing = selectedDrawing("z-drawing", 20, 300);
    const visible = Array.from({ length: 4 }, (_, index) =>
      canvasImageNode(`visible-${index + 1}`, 50 + index * 180),
    );
    const imageNodes = [selectedImage, ...visible];
    const document = tldrawBoardDocument(
      imageNodes.map((node, index) =>
        imageShape({
          shapeId: `shape:${node.id}`,
          nodeId: node.id,
          assetId: `asset:${node.id}`,
          index: `a${index + 1}`,
        }),
      ),
    );
    const assetLookups: string[] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = queryText(strings);
      if (text.includes("from boards")) return [{ document }];
      if (text.includes("from board_assets")) {
        assetLookups.push(String(values[1]));
        return [{
          id: `storage-${assetLookups.length}`,
          contentHash: String(assetLookups.length).repeat(64).slice(0, 64),
        }];
      }
      throw new Error(`Unexpected query: ${text}`);
    });
    mocks.issueAiMediaToken.mockImplementation(async (input) => {
      if (input.claim.kind === "selection-preview") return "scene-capability";
      if (input.claim.kind === "selected-drawing-preview") return "drawing-capability";
      return `asset-capability-${input.claim.assetId}`;
    });
    const selectedImageSnapshot = {
      id: selectedImage.id,
      type: selectedImage.type,
      title: selectedImage.title,
      x: selectedImage.x,
      y: selectedImage.y,
      width: selectedImage.width,
      height: selectedImage.height,
    };
    const selection = [selectedImageSnapshot, drawing];
    const scene = buildAuthorizedBoardScene({
      snapshot: {
        nodes: [
          ...imageNodes,
          {
            id: drawing.id,
            type: drawing.type,
            title: drawing.title,
            x: drawing.x,
            y: drawing.y,
            width: drawing.width,
            height: drawing.height,
            fill: "#ffffff",
          },
        ],
        edges: [],
      },
      selection,
      viewport: baseRequest.viewport,
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: { ...baseRequest, selection, scene },
    });

    expect(assetLookups).toHaveLength(3);
    expect(assetLookups[0]).toBe("asset:selected-image");
    expect(images).toHaveLength(5);
    expect(images[0]?.label).toContain("Authorized scene preview");
    expect(images[1]?.label).toContain("High-resolution crop");
    expect(images[2]?.label).toContain("exact selected board image for scene handle s1");
  });

  it("does not expose cross-board or missing selected assets", async () => {
    const document = tldrawBoardDocument([
      imageShape({
        shapeId: "shape:cross-board",
        nodeId: "cross-board-image",
        assetId: "asset:cross_board",
        index: "a1",
      }),
      imageShape({
        shapeId: "shape:missing",
        nodeId: "missing-image",
        assetId: "asset:missing",
        index: "a2",
      }),
    ]);
    const assetLookups: unknown[][] = [];
    const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = queryText(strings);
      if (text.includes("from boards")) return [{ document }];
      if (text.includes("from board_assets")) {
        assetLookups.push(values);
        // A row may exist in another tenant, but the required board predicate
        // prevents that row from satisfying this lookup.
        return [];
      }
      throw new Error(`Unexpected query: ${text}`);
    });

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: {
        ...baseRequest,
        selection: [
          {
            id: "cross-board-image",
            type: "image",
            title: "Cross-board candidate",
            x: 0,
            y: 0,
            width: 320,
            height: 180,
          },
          {
            id: "missing-image",
            type: "image",
            title: "Missing candidate",
            x: 400,
            y: 0,
            width: 320,
            height: 180,
          },
        ],
      },
    });

    expect(images).toEqual([]);
    expect(mocks.issueAiMediaToken).not.toHaveBeenCalled();
    expect(assetLookups).toEqual([
      [boardId, "asset:cross_board"],
      [boardId, "asset:missing"],
    ]);
  });
});
