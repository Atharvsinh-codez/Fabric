// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/boards/client", () => ({
  listBoardImageAssets: vi.fn(),
  updateBoardMetadata: vi.fn(),
}));

import { BoardCoverPicker } from "./board-cover-picker";
import {
  listBoardImageAssets,
  updateBoardMetadata,
  type BoardSummary,
} from "@/lib/boards/client";

const board = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Launch map",
  cover: null,
  role: "editor",
} as BoardSummary;

describe("BoardCoverPicker", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(listBoardImageAssets).mockResolvedValue([
      {
        id: "22222222-2222-4222-8222-222222222222",
        tldrawAssetId: "asset:cover",
        src: `/api/boards/${board.id}/assets/22222222-2222-4222-8222-222222222222`,
        mimeType: "image/png",
        originalName: "cover.png",
        byteSize: 8,
        updatedAt: "2026-07-15T10:00:00.000Z",
      },
    ]);
    vi.mocked(updateBoardMetadata).mockResolvedValue({
      ...board,
      cover: { kind: "asset", assetId: "22222222-2222-4222-8222-222222222222" },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("lazy-loads authorized images and selects only their stable asset ID", async () => {
    const onUpdated = vi.fn();
    await act(async () => {
      root.render(
        <BoardCoverPicker
          board={board}
          onUpdated={onUpdated}
          onError={vi.fn()}
        />,
      );
    });
    expect(listBoardImageAssets).not.toHaveBeenCalled();

    await act(async () => {
      (
        container.querySelector(
          'button[aria-haspopup="dialog"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(listBoardImageAssets).toHaveBeenCalledWith(board.id);

    await act(async () => {
      (
        container.querySelector(
          'button[aria-label^="Use cover.png"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(updateBoardMetadata).toHaveBeenCalledWith({
      boardId: board.id,
      cover: { kind: "asset", assetId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        cover: expect.objectContaining({ kind: "asset" }),
      }),
    );
  });
});
