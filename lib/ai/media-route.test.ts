import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  verifyAiMediaToken: vi.fn(),
  renderAiSelectionPreview: vi.fn(),
  renderAiScenePreview: vi.fn(),
  createBoardAssetResponse: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/clients/web", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/ai/media-token", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/media-token")>();
  return { ...original, verifyAiMediaToken: mocks.verifyAiMediaToken };
});
vi.mock("@/lib/ai/server/selection-preview", () => ({
  renderAiSelectionPreview: mocks.renderAiSelectionPreview,
  renderAiScenePreview: mocks.renderAiScenePreview,
}));
vi.mock("@/lib/boards/assets/response", () => ({
  createBoardAssetResponse: mocks.createBoardAssetResponse,
}));

import { GET } from "@/app/api/ai/media/[token]/route";
import { buildAuthorizedBoardScene } from "@/lib/ai/engine/authorized-scene";
import { deriveAiMediaSigningKey } from "@/lib/ai/media-token";

const previousAuthSecret = process.env.AUTH_SECRET;
const authSecret = "auth-secret-with-at-least-thirty-two-random-characters";
const runId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";
const selectionHash = "a".repeat(64);
const selection = [
  {
    id: "drawing-1",
    type: "drawing" as const,
    title: "Drawing",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    source: {
      shapeType: "draw" as const,
      segments: [
        {
          type: "free" as const,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 100 },
          ],
        },
      ],
    },
  },
];
const executionInput = {
  skill: "canvas-agent" as const,
  workspaceId: "33333333-3333-4333-8333-333333333333",
  boardId,
  documentGenerationId: "44444444-4444-4444-8444-444444444444",
  durableSequence: 1,
  instruction: "Understand the selected sketch",
  selection,
  viewport: { x: 0, y: 0, width: 800, height: 600 },
  conversation: [],
};
const scene = buildAuthorizedBoardScene({
  snapshot: {
    nodes: [
      {
        id: selection[0]!.id,
        type: selection[0]!.type,
        title: selection[0]!.title,
        x: selection[0]!.x,
        y: selection[0]!.y,
        width: selection[0]!.width,
        height: selection[0]!.height,
        fill: "#ffffff",
      },
    ],
    edges: [],
  },
  selection,
  viewport: executionInput.viewport,
});

function selectResults(...results: unknown[][]): void {
  const limit = vi.fn();
  for (const result of results) limit.mockResolvedValueOnce(result);
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin, where }));
  mocks.select.mockImplementation(() => ({ from }));
}

function request(): Request {
  return new Request("https://fabric.test/api/ai/media/opaque-token");
}

function context(): { params: Promise<{ token: string }> } {
  return { params: Promise.resolve({ token: "opaque-token" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_SECRET = authSecret;
  mocks.verifyAiMediaToken.mockResolvedValue({
    kind: "selection-preview",
    runId,
    boardId,
  });
  mocks.renderAiSelectionPreview.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  mocks.renderAiScenePreview.mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
  selectResults([{ boardId, selectionHash, executionInput }]);
});

afterEach(() => {
  if (previousAuthSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousAuthSecret;
});

describe("AI media route", () => {
  it("serves the authorized run selection without requiring an auth cookie", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.verifyAiMediaToken).toHaveBeenCalledWith(
      "opaque-token",
      expect.objectContaining({
        signingKey: deriveAiMediaSigningKey(authSecret),
        now: expect.any(Date),
      }),
    );
    expect(mocks.renderAiSelectionPreview).toHaveBeenCalledWith(selection);
  });

  it("serves a selection-hash-bound drawing crop even when the run also has a scene", async () => {
    mocks.verifyAiMediaToken.mockResolvedValue({
      kind: "selected-drawing-preview",
      runId,
      boardId,
      selectionHash,
    });
    selectResults([{
      boardId,
      selectionHash,
      executionInput: { ...executionInput, scene },
    }]);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.renderAiSelectionPreview).toHaveBeenCalledWith(selection);
    expect(mocks.renderAiScenePreview).not.toHaveBeenCalled();
  });

  it("serves the global scene for the existing scene-preview capability", async () => {
    selectResults([{
      boardId,
      selectionHash,
      executionInput: { ...executionInput, scene },
    }]);

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(mocks.renderAiScenePreview).toHaveBeenCalledWith(scene);
    expect(mocks.renderAiSelectionPreview).not.toHaveBeenCalled();
  });

  it("hides a selected-drawing capability whose selection hash no longer matches", async () => {
    mocks.verifyAiMediaToken.mockResolvedValue({
      kind: "selected-drawing-preview",
      runId,
      boardId,
      selectionHash,
    });
    selectResults([{
      boardId,
      selectionHash: "b".repeat(64),
      executionInput: { ...executionInput, scene },
    }]);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.renderAiSelectionPreview).not.toHaveBeenCalled();
    expect(mocks.renderAiScenePreview).not.toHaveBeenCalled();
  });

  it("hides an absent, terminal, archived, or expired run behind one not-found response", async () => {
    selectResults([]);
    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.renderAiSelectionPreview).not.toHaveBeenCalled();
    expect(mocks.renderAiScenePreview).not.toHaveBeenCalled();
  });

  it("fails closed when the source auth secret is missing", async () => {
    delete process.env.AUTH_SECRET;
    const response = await GET(request(), context());

    expect(response.status).toBe(503);
    expect(mocks.verifyAiMediaToken).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
