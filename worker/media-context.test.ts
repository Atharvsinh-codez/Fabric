import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardDocument } from "../db/schema/product";
import type { AiProposalRequest } from "../lib/ai/proposal-request";

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
const media = {
  baseUrl: "https://fabric.example.test",
  signingKey: "production-media-signing-secret-with-independent-entropy",
};

const job = {
  runId,
  boardId,
  documentGenerationId,
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
  it("issues a run-bound preview capability without reading the board for vector selections", async () => {
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
      claim: { kind: "selection-preview", runId, boardId },
    });
    expect(images).toEqual([
      expect.objectContaining({
        url: "https://fabric.example.test/api/ai/media/preview-capability",
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
    mocks.issueAiMediaToken.mockResolvedValue("asset-capability");

    const images = await buildAiModelImages({
      sql: sql as unknown as WorkerSql,
      job,
      media,
      request: {
        ...baseRequest,
        selection: [
          {
            id: "selected-image",
            type: "image",
            title: "Client supplied title only",
            x: 0,
            y: 0,
            width: 320,
            height: 180,
          },
        ],
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
        url: "https://fabric.example.test/api/ai/media/asset-capability",
        detail: "high",
      }),
    ]);
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
