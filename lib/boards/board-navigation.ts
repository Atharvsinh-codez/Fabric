import type { TLShapeId } from "tldraw";

export const BOARD_NAVIGATION_INDEX_LIMIT = 2_000;
export const BOARD_NAVIGATION_RESULT_LIMIT = 40;
export const BOARD_NAVIGATION_MINIMAP_LIMIT = 180;
export const BOARD_BOOKMARK_LIMIT = 20;

const BOOKMARK_LABEL_LIMIT = 60;
const BOOKMARK_ID_PATTERN = /^[A-Za-z0-9:_-]{1,96}$/;
const MAX_CANVAS_COORDINATE = 1_000_000_000;
const MIN_CAMERA_ZOOM = 0.01;
const MAX_CAMERA_ZOOM = 128;

export type BoardNavigationBounds = Readonly<{
  x: number;
  y: number;
  w: number;
  h: number;
}>;

export type BoardNavigationPoint = Readonly<{
  x: number;
  y: number;
}>;

export type BoardCameraLocation = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type BoardNavigationItem = Readonly<{
  id: TLShapeId;
  label: string;
  typeLabel: string;
  bounds: BoardNavigationBounds;
}>;

export type BoardBookmark = Readonly<{
  id: string;
  label: string;
  camera: BoardCameraLocation;
  createdAt: number;
}>;

export type ProjectedNavigationBounds = BoardNavigationBounds &
  Readonly<{ id: TLShapeId }>;

export type BoardMinimapModel = Readonly<{
  width: number;
  height: number;
  contentBounds: BoardNavigationBounds;
  scale: number;
  offsetX: number;
  offsetY: number;
  shapes: readonly ProjectedNavigationBounds[];
  viewport: BoardNavigationBounds;
}>;

export type BoardNavigationSearchResult = Readonly<{
  items: readonly BoardNavigationItem[];
  total: number;
}>;

function isFiniteWithin(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

export function isBoardNavigationBounds(value: unknown): value is BoardNavigationBounds {
  if (typeof value !== "object" || value === null) return false;
  const x = Reflect.get(value, "x");
  const y = Reflect.get(value, "y");
  const w = Reflect.get(value, "w");
  const h = Reflect.get(value, "h");
  return (
    isFiniteWithin(x, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE) &&
    isFiniteWithin(y, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE) &&
    isFiniteWithin(w, 0, MAX_CANVAS_COORDINATE) &&
    isFiniteWithin(h, 0, MAX_CANVAS_COORDINATE)
  );
}

export function normalizeBoardNavigationLabel(
  value: string,
  fallback: string,
  maxLength = BOOKMARK_LABEL_LIMIT,
): string {
  const boundedMaximum = Math.max(1, Math.min(160, Math.floor(maxLength)));
  const normalized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalizedFallback = fallback
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || normalizedFallback || "Object").slice(0, boundedMaximum);
}

function normalizedSearchValue(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function navigationItemScore(item: BoardNavigationItem, query: string): number {
  const label = normalizedSearchValue(item.label);
  const type = normalizedSearchValue(item.typeLabel);
  if (label === query) return 0;
  if (label.startsWith(query)) return 1;
  if (label.includes(query)) return 2;
  if (type === query) return 3;
  if (type.startsWith(query)) return 4;
  return 5;
}

export function searchBoardNavigationItems(
  items: readonly BoardNavigationItem[],
  query: string,
  limit = BOARD_NAVIGATION_RESULT_LIMIT,
): BoardNavigationSearchResult {
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const normalizedQuery = normalizedSearchValue(query).slice(0, 120);
  if (!normalizedQuery) {
    return {
      items: items.slice(0, boundedLimit),
      total: items.length,
    };
  }

  const terms = normalizedQuery.split(" ").filter(Boolean).slice(0, 8);
  const matches = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => {
      const haystack = normalizedSearchValue(`${item.label} ${item.typeLabel}`);
      return terms.every((term) => haystack.includes(term));
    })
    .sort((left, right) => {
      const scoreDifference =
        navigationItemScore(left.item, normalizedQuery) -
        navigationItemScore(right.item, normalizedQuery);
      return scoreDifference || left.index - right.index;
    });

  return {
    items: matches.slice(0, boundedLimit).map(({ item }) => item),
    total: matches.length,
  };
}

function unionBounds(bounds: readonly BoardNavigationBounds[]): BoardNavigationBounds {
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + Math.max(1, item.w)));
  const maxY = Math.max(...bounds.map((item) => item.y + Math.max(1, item.h)));
  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

function projectBounds(
  bounds: BoardNavigationBounds,
  contentBounds: BoardNavigationBounds,
  scale: number,
  offsetX: number,
  offsetY: number,
  minimumSize: number,
): BoardNavigationBounds {
  return {
    x: offsetX + (bounds.x - contentBounds.x) * scale,
    y: offsetY + (bounds.y - contentBounds.y) * scale,
    w: Math.max(minimumSize, bounds.w * scale),
    h: Math.max(minimumSize, bounds.h * scale),
  };
}

export function buildBoardMinimapModel(
  items: readonly BoardNavigationItem[],
  viewport: BoardNavigationBounds,
  options: Readonly<{
    width?: number;
    height?: number;
    padding?: number;
    shapeLimit?: number;
  }> = {},
): BoardMinimapModel {
  const safeViewport = isBoardNavigationBounds(viewport)
    ? viewport
    : { x: 0, y: 0, w: 1, h: 1 };
  const width = Math.max(80, Math.min(1_000, options.width ?? 320));
  const height = Math.max(48, Math.min(1_000, options.height ?? 144));
  const padding = Math.max(
    0,
    Math.min(Math.min(width, height) / 3, options.padding ?? 10),
  );
  const shapeLimit = Math.max(
    1,
    Math.min(BOARD_NAVIGATION_INDEX_LIMIT, options.shapeLimit ?? BOARD_NAVIGATION_MINIMAP_LIMIT),
  );
  const safeItems = items
    .filter((item) => isBoardNavigationBounds(item.bounds))
    .slice(0, shapeLimit);
  const contentBounds = unionBounds([
    safeViewport,
    ...safeItems.map((item) => item.bounds),
  ]);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const scale = Math.max(
    Number.EPSILON,
    Math.min(availableWidth / contentBounds.w, availableHeight / contentBounds.h),
  );
  const projectedWidth = contentBounds.w * scale;
  const projectedHeight = contentBounds.h * scale;
  const offsetX = (width - projectedWidth) / 2;
  const offsetY = (height - projectedHeight) / 2;

  return {
    width,
    height,
    contentBounds,
    scale,
    offsetX,
    offsetY,
    shapes: safeItems.map((item) => ({
      id: item.id,
      ...projectBounds(
        item.bounds,
        contentBounds,
        scale,
        offsetX,
        offsetY,
        2,
      ),
    })),
    viewport: projectBounds(
      safeViewport,
      contentBounds,
      scale,
      offsetX,
      offsetY,
      8,
    ),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function minimapPointToPagePoint(
  model: BoardMinimapModel,
  point: BoardNavigationPoint,
): BoardNavigationPoint {
  const scaledX = (point.x - model.offsetX) / model.scale;
  const scaledY = (point.y - model.offsetY) / model.scale;
  return {
    x:
      model.contentBounds.x +
      clamp(scaledX, 0, model.contentBounds.w),
    y:
      model.contentBounds.y +
      clamp(scaledY, 0, model.contentBounds.h),
  };
}

export function boardBookmarkStorageKey(boardId: string): string {
  const normalizedBoardId = boardId.normalize("NFKC").trim().slice(0, 128);
  return `fabric:board-navigation:${encodeURIComponent(normalizedBoardId || "unknown")}:bookmarks:v1`;
}

function parseBoardCameraLocation(value: unknown): BoardCameraLocation | null {
  if (typeof value !== "object" || value === null) return null;
  const x = Reflect.get(value, "x");
  const y = Reflect.get(value, "y");
  const z = Reflect.get(value, "z");
  if (
    !isFiniteWithin(x, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE) ||
    !isFiniteWithin(y, -MAX_CANVAS_COORDINATE, MAX_CANVAS_COORDINATE) ||
    !isFiniteWithin(z, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM)
  ) {
    return null;
  }
  return { x, y, z };
}

export function parseBoardBookmarks(raw: string | null): readonly BoardBookmark[] {
  if (!raw || raw.length > 64_000) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const bookmarks: BoardBookmark[] = [];
  const seenIds = new Set<string>();
  for (const value of parsed.slice(0, BOARD_BOOKMARK_LIMIT * 2)) {
    if (typeof value !== "object" || value === null) continue;
    const id = Reflect.get(value, "id");
    const label = Reflect.get(value, "label");
    const createdAt = Reflect.get(value, "createdAt");
    const camera = parseBoardCameraLocation(Reflect.get(value, "camera"));
    if (
      typeof id !== "string" ||
      !BOOKMARK_ID_PATTERN.test(id) ||
      seenIds.has(id) ||
      typeof label !== "string" ||
      !camera ||
      !isFiniteWithin(createdAt, 0, Number.MAX_SAFE_INTEGER)
    ) {
      continue;
    }
    seenIds.add(id);
    bookmarks.push({
      id,
      label: normalizeBoardNavigationLabel(label, "Saved View", BOOKMARK_LABEL_LIMIT),
      camera,
      createdAt,
    });
    if (bookmarks.length === BOARD_BOOKMARK_LIMIT) break;
  }
  return bookmarks;
}

export function serializeBoardBookmarks(bookmarks: readonly BoardBookmark[]): string {
  return JSON.stringify(bookmarks.slice(0, BOARD_BOOKMARK_LIMIT));
}
