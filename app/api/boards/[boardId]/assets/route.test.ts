import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  listBoardImageAssets: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));
vi.mock("@/lib/boards/assets/repository", () => ({
  deleteBoardAssets: vi.fn(),
  listBoardImageAssets: mocks.listBoardImageAssets,
  storeBoardAsset: vi.fn(),
}));

import { GET } from "./route";

const userId = "11111111-1111-4111-8111-111111111111";
const boardId = "22222222-2222-4222-8222-222222222222";

describe("GET /api/boards/:boardId/assets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePrincipal.mockResolvedValue({ id: userId });
  });

  it("passes the authenticated user and exact board scope to the image listing", async () => {
    const asset = {
      id: "33333333-3333-4333-8333-333333333333",
      tldrawAssetId: "asset:cover",
      src: `/api/boards/${boardId}/assets/33333333-3333-4333-8333-333333333333`,
      mimeType: "image/png",
      originalName: "cover.png",
      byteSize: 8,
      updatedAt: "2026-07-15T10:00:00.000Z",
    };
    mocks.listBoardImageAssets.mockResolvedValue([asset]);

    const response = await GET(
      new Request(`https://fabric.test/api/boards/${boardId}/assets`),
      {
        params: Promise.resolve({ boardId }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ assets: [asset] });
    expect(mocks.listBoardImageAssets).toHaveBeenCalledWith({
      userId,
      boardId,
    });
  });

  it("rejects an invalid board identifier before querying assets", async () => {
    const response = await GET(
      new Request("https://fabric.test/api/boards/nope/assets"),
      {
        params: Promise.resolve({ boardId: "nope" }),
      },
    );

    expect(response.status).toBe(422);
    expect(mocks.listBoardImageAssets).not.toHaveBeenCalled();
  });
});
