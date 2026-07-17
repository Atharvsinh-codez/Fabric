import { createShapeId } from "tldraw";
import { describe, expect, it } from "vitest";

import {
  BOARD_BOOKMARK_LIMIT,
  boardBookmarkStorageKey,
  buildBoardMinimapModel,
  isBoardNavigationBounds,
  minimapPointToPagePoint,
  normalizeBoardNavigationLabel,
  parseBoardBookmarks,
  searchBoardNavigationItems,
  serializeBoardBookmarks,
  type BoardBookmark,
  type BoardNavigationItem,
} from "./board-navigation";

function navigationItem(
  key: string,
  label: string,
  typeLabel: string,
  x: number,
  y: number,
): BoardNavigationItem {
  return {
    id: createShapeId(key),
    label,
    typeLabel,
    bounds: { x, y, w: 100, h: 60 },
  };
}

describe("board navigation helpers", () => {
  it("normalizes untrusted labels and keeps a readable fallback", () => {
    expect(
      normalizeBoardNavigationLabel("  Chapter\n\u0000  Three   Map  ", "Object"),
    ).toBe("Chapter Three Map");
    expect(normalizeBoardNavigationLabel("\u0000\n", "Saved View")).toBe(
      "Saved View",
    );
    expect(normalizeBoardNavigationLabel("abcdefgh", "Object", 4)).toBe("abcd");
  });

  it("searches labels and object types with stable relevance and a hard result cap", () => {
    const items = [
      navigationItem("one", "Cell Division", "Frame", 0, 0),
      navigationItem("two", "Division Practice", "Note", 200, 0),
      navigationItem("three", "Cell Membrane", "Rectangle", 400, 0),
      navigationItem("four", "Homework", "Cell Note", 600, 0),
    ];

    expect(searchBoardNavigationItems(items, "division").items.map((item) => item.id)).toEqual([
      createShapeId("two"),
      createShapeId("one"),
    ]);
    expect(searchBoardNavigationItems(items, "cell note").items.map((item) => item.id)).toEqual([
      createShapeId("four"),
    ]);
    expect(searchBoardNavigationItems(items, "", 2)).toEqual({
      items: items.slice(0, 2),
      total: 4,
    });
  });

  it("projects board content and the viewport into a bounded minimap", () => {
    const items = [
      navigationItem("left", "Left", "Note", -100, 50),
      navigationItem("right", "Right", "Frame", 900, 550),
    ];
    const model = buildBoardMinimapModel(
      items,
      { x: 100, y: 100, w: 400, h: 300 },
      { width: 320, height: 144, padding: 10 },
    );

    expect(model.width).toBe(320);
    expect(model.height).toBe(144);
    expect(model.shapes).toHaveLength(2);
    expect(model.shapes.every((shape) => shape.w >= 2 && shape.h >= 2)).toBe(true);
    expect(model.viewport.w).toBeGreaterThanOrEqual(8);
    expect(model.viewport.h).toBeGreaterThanOrEqual(8);
    expect(model.offsetX).toBeGreaterThanOrEqual(0);
    expect(model.offsetY).toBeGreaterThanOrEqual(0);
  });

  it("maps minimap clicks back to canvas points and clamps padded edges", () => {
    const model = buildBoardMinimapModel(
      [navigationItem("shape", "Shape", "Rectangle", 0, 0)],
      { x: 25, y: 10, w: 50, h: 50 },
      { width: 200, height: 100, padding: 10 },
    );
    const center = minimapPointToPagePoint(model, {
      x: model.offsetX + (model.contentBounds.w * model.scale) / 2,
      y: model.offsetY + (model.contentBounds.h * model.scale) / 2,
    });

    expect(center.x).toBeCloseTo(model.contentBounds.x + model.contentBounds.w / 2);
    expect(center.y).toBeCloseTo(model.contentBounds.y + model.contentBounds.h / 2);
    expect(minimapPointToPagePoint(model, { x: -1_000, y: -1_000 })).toEqual({
      x: model.contentBounds.x,
      y: model.contentBounds.y,
    });
  });

  it("rejects invalid geometry before it reaches minimap math", () => {
    expect(isBoardNavigationBounds({ x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(isBoardNavigationBounds({ x: Number.NaN, y: 0, w: 10, h: 10 })).toBe(false);
    expect(isBoardNavigationBounds({ x: 0, y: 0, w: -1, h: 10 })).toBe(false);
    expect(isBoardNavigationBounds({ x: 0, y: 0, w: 10 })).toBe(false);
  });

  it("parses only bounded, unique, finite device-local bookmarks", () => {
    const valid = Array.from({ length: BOARD_BOOKMARK_LIMIT + 4 }, (_, index) => ({
      id: `bookmark:${index}`,
      label: `  View ${index}  `,
      camera: { x: index, y: -index, z: 1 },
      createdAt: index + 1,
    }));
    const raw = JSON.stringify([
      ...valid,
      valid[0],
      {
        id: "bookmark:bad-zoom",
        label: "Bad Zoom",
        camera: { x: 0, y: 0, z: Number.POSITIVE_INFINITY },
        createdAt: 1,
      },
      {
        id: "not allowed spaces",
        label: "Bad ID",
        camera: { x: 0, y: 0, z: 1 },
        createdAt: 1,
      },
    ]);

    const parsed = parseBoardBookmarks(raw);
    expect(parsed).toHaveLength(BOARD_BOOKMARK_LIMIT);
    expect(new Set(parsed.map((bookmark) => bookmark.id)).size).toBe(parsed.length);
    expect(parsed[0]?.label).toBe("View 0");
    expect(parseBoardBookmarks("not json")).toEqual([]);
    expect(parseBoardBookmarks(JSON.stringify({ bookmarks: valid }))).toEqual([]);
  });

  it("round-trips persisted bookmarks and scopes the key to one board", () => {
    const bookmarks: readonly BoardBookmark[] = [
      {
        id: "bookmark:biology",
        label: "Biology Overview",
        camera: { x: -240, y: 120, z: 0.75 },
        createdAt: 42,
      },
    ];

    expect(parseBoardBookmarks(serializeBoardBookmarks(bookmarks))).toEqual(bookmarks);
    expect(boardBookmarkStorageKey("board / biology")).toBe(
      "fabric:board-navigation:board%20%2F%20biology:bookmarks:v1",
    );
    expect(boardBookmarkStorageKey("   ")).toContain(":unknown:");
  });
});
