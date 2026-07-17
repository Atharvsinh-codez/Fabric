"use client";

import {
  ArrowUturnLeftIcon,
  BookmarkIcon,
  MagnifyingGlassIcon,
  MapIcon,
  Square3Stack3DIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  renderPlaintextFromRichText,
  type Editor,
  type TLRichText,
  type TLShape,
} from "tldraw";

import { Button, IconButton } from "@/components/ui";
import {
  BOARD_BOOKMARK_LIMIT,
  BOARD_NAVIGATION_INDEX_LIMIT,
  boardBookmarkStorageKey,
  buildBoardMinimapModel,
  isBoardNavigationBounds,
  minimapPointToPagePoint,
  normalizeBoardNavigationLabel,
  parseBoardBookmarks,
  searchBoardNavigationItems,
  serializeBoardBookmarks,
  type BoardBookmark,
  type BoardCameraLocation,
  type BoardNavigationBounds,
  type BoardNavigationItem,
} from "@/lib/boards/board-navigation";

const MINIMAP_WIDTH = 320;
const MINIMAP_HEIGHT = 144;

type NavigationSnapshot = Readonly<{
  items: readonly BoardNavigationItem[];
  viewport: BoardNavigationBounds;
  totalObjects: number;
}>;

const emptySnapshot: NavigationSnapshot = {
  items: [],
  viewport: { x: 0, y: 0, w: 1, h: 1 },
  totalObjects: 0,
};

const shapeTypeNames: Readonly<Record<string, string>> = {
  arrow: "Connector",
  bookmark: "Link",
  draw: "Drawing",
  embed: "Embed",
  frame: "Frame",
  geo: "Shape",
  group: "Group",
  highlight: "Highlight",
  image: "Image",
  line: "Line",
  note: "Note",
  text: "Text",
  video: "Video",
};

function titleFromShapeType(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  if (!normalized) return "Object";
  return normalized
    .split(" ")
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function propertyString(shape: TLShape, property: string): string {
  const value = Reflect.get(shape.props, property);
  return typeof value === "string" ? value : "";
}

function isTldrawRichText(value: unknown): value is TLRichText {
  return (
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "type") === "doc"
  );
}

function shapeTypeLabel(shape: TLShape): string {
  if (shape.type === "geo") {
    const geometry = propertyString(shape, "geo");
    if (geometry) return titleFromShapeType(geometry);
  }
  return shapeTypeNames[shape.type] ?? titleFromShapeType(shape.type);
}

function urlSummary(value: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function shapeLabel(editor: Editor, shape: TLShape, typeLabel: string): string {
  const richText = Reflect.get(shape.props, "richText");
  if (isTldrawRichText(richText)) {
    try {
      const text = renderPlaintextFromRichText(editor, richText);
      if (text.trim()) {
        return normalizeBoardNavigationLabel(text, typeLabel, 100);
      }
    } catch {
      // A custom or stale rich-text extension should not prevent board navigation.
    }
  }

  const descriptiveValue =
    propertyString(shape, "name") ||
    propertyString(shape, "altText") ||
    urlSummary(propertyString(shape, "url"));
  return normalizeBoardNavigationLabel(descriptiveValue, typeLabel, 100);
}

function readNavigationViewport(editor: Editor): BoardNavigationBounds {
  try {
    const viewport = editor.getViewportPageBounds();
    return isBoardNavigationBounds(viewport)
      ? { x: viewport.x, y: viewport.y, w: viewport.w, h: viewport.h }
      : emptySnapshot.viewport;
  } catch {
    return emptySnapshot.viewport;
  }
}

function readNavigationDocument(
  editor: Editor,
): Pick<NavigationSnapshot, "items" | "totalObjects"> {
  try {
    const shapes = editor.getCurrentPageShapesSorted();
    const indexedShapes = shapes
      .slice(Math.max(0, shapes.length - BOARD_NAVIGATION_INDEX_LIMIT))
      .reverse();
    const items: BoardNavigationItem[] = [];

    for (const shape of indexedShapes) {
      const bounds = editor.getShapePageBounds(shape);
      if (!isBoardNavigationBounds(bounds)) continue;
      const typeLabel = shapeTypeLabel(shape);
      items.push({
        id: shape.id,
        typeLabel,
        label: shapeLabel(editor, shape, typeLabel),
        bounds: { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h },
      });
    }

    return {
      items,
      totalObjects: shapes.length,
    };
  } catch {
    return { items: [], totalObjects: 0 };
  }
}

function cameraLocation(editor: Editor): BoardCameraLocation {
  const camera = editor.getCamera();
  return { x: camera.x, y: camera.y, z: camera.z };
}

function localBookmarkId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `bookmark:${crypto.randomUUID()}`;
  }
  return `bookmark:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export function FabricBoardNavigationPanel({
  editor,
  boardId,
  onAnnouncement,
}: {
  editor: Editor | null;
  boardId: string;
  onAnnouncement?: (message: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<NavigationSnapshot>(() =>
    editor
      ? {
          ...readNavigationDocument(editor),
          viewport: readNavigationViewport(editor),
        }
      : emptySnapshot,
  );
  const [query, setQuery] = useState("");
  const [bookmarkName, setBookmarkName] = useState("");
  const [bookmarks, setBookmarks] = useState<readonly BoardBookmark[]>([]);
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<BoardCameraLocation | null>(null);
  const snapshotEditorRef = useRef<Editor | null>(editor);
  const documentTimerRef = useRef<number | null>(null);
  const viewportTimerRef = useRef<number | null>(null);
  const storageKey = useMemo(() => boardBookmarkStorageKey(boardId), [boardId]);

  useEffect(() => {
    if (!editor) {
      const resetTimer = snapshotEditorRef.current
        ? window.setTimeout(() => setSnapshot(emptySnapshot), 0)
        : null;
      snapshotEditorRef.current = null;
      return () => {
        if (resetTimer !== null) window.clearTimeout(resetTimer);
      };
    }

    const refreshDocument = () => {
      const document = readNavigationDocument(editor);
      setSnapshot((current) => ({ ...current, ...document }));
    };
    const refreshViewport = () => {
      const viewport = readNavigationViewport(editor);
      setSnapshot((current) => ({ ...current, viewport }));
    };
    const scheduleDocumentRefresh = () => {
      if (documentTimerRef.current !== null) return;
      documentTimerRef.current = window.setTimeout(() => {
        documentTimerRef.current = null;
        refreshDocument();
      }, 120);
    };
    const scheduleViewportRefresh = () => {
      if (viewportTimerRef.current !== null) return;
      viewportTimerRef.current = window.setTimeout(() => {
        viewportTimerRef.current = null;
        refreshViewport();
      }, 100);
    };
    const editorChanged = snapshotEditorRef.current !== editor;
    snapshotEditorRef.current = editor;
    const editorRefreshTimer = editorChanged
      ? window.setTimeout(() => {
          setSnapshot({
            ...readNavigationDocument(editor),
            viewport: readNavigationViewport(editor),
          });
        }, 0)
      : null;
    const disposeDocument = editor.store.listen(scheduleDocumentRefresh, {
      source: "all",
      scope: "document",
    });
    const disposeSession = editor.store.listen(scheduleViewportRefresh, {
      source: "all",
      scope: "session",
    });

    return () => {
      disposeDocument();
      disposeSession();
      if (editorRefreshTimer !== null) window.clearTimeout(editorRefreshTimer);
      if (documentTimerRef.current !== null) {
        window.clearTimeout(documentTimerRef.current);
        documentTimerRef.current = null;
      }
      if (viewportTimerRef.current !== null) {
        window.clearTimeout(viewportTimerRef.current);
        viewportTimerRef.current = null;
      }
    };
  }, [editor]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      try {
        const storedBookmarks = parseBoardBookmarks(window.localStorage.getItem(storageKey));
        setBookmarks(storedBookmarks);
      } catch {
        setBookmarks([]);
      }
      setLoadedStorageKey(storageKey);
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [storageKey]);

  const searchResult = useMemo(
    () => searchBoardNavigationItems(snapshot.items, query),
    [query, snapshot.items],
  );
  const minimap = useMemo(
    () =>
      buildBoardMinimapModel(snapshot.items, snapshot.viewport, {
        width: MINIMAP_WIDTH,
        height: MINIMAP_HEIGHT,
      }),
    [snapshot.items, snapshot.viewport],
  );
  const storageReady = loadedStorageKey === storageKey;

  const announce = useCallback(
    (message: string) => onAnnouncement?.(message),
    [onAnnouncement],
  );

  const rememberLocation = useCallback(() => {
    if (!editor) return;
    setLastLocation(cameraLocation(editor));
  }, [editor]);

  const navigateToObject = useCallback(
    (item: BoardNavigationItem) => {
      if (!editor) return;
      if (!editor.getShape(item.id)) {
        announce("That object is no longer on this page. Refresh the outline and try again.");
        return;
      }
      rememberLocation();
      editor.select(item.id);
      editor.zoomToBounds(item.bounds, {
        animation: { duration: 220 },
        inset: 80,
        targetZoom: 1,
      });
      announce(`Moved to ${item.label}.`);
    },
    [announce, editor, rememberLocation],
  );

  const navigateFromMinimap = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (!editor) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      let minimapPoint = {
        x: minimap.width / 2,
        y: minimap.height / 2,
      };
      if (event.detail !== 0 && bounds.width > 0 && bounds.height > 0) {
        minimapPoint = {
          x: ((event.clientX - bounds.left) / bounds.width) * minimap.width,
          y: ((event.clientY - bounds.top) / bounds.height) * minimap.height,
        };
      }
      const point = minimapPointToPagePoint(minimap, minimapPoint);
      rememberLocation();
      editor.centerOnPoint(point, { animation: { duration: 220 } });
      announce("Moved to the selected board area.");
    },
    [announce, editor, minimap, rememberLocation],
  );

  const returnToLastLocation = useCallback(() => {
    if (!editor || !lastLocation) return;
    const currentLocation = cameraLocation(editor);
    editor.setCamera(lastLocation, { animation: { duration: 220 } });
    setLastLocation(currentLocation);
    announce("Returned to your previous board location.");
  }, [announce, editor, lastLocation]);

  const commitBookmarks = useCallback(
    (nextBookmarks: readonly BoardBookmark[]): boolean => {
      if (!storageReady) return false;
      try {
        window.localStorage.setItem(
          storageKey,
          serializeBoardBookmarks(nextBookmarks),
        );
        setBookmarks(nextBookmarks);
        return true;
      } catch {
        announce(
          "Bookmark could not be saved on this device. Check browser storage and try again.",
        );
        return false;
      }
    },
    [announce, storageKey, storageReady],
  );

  const saveBookmark = useCallback(() => {
    if (!editor || !storageReady) return;
    if (bookmarks.length >= BOARD_BOOKMARK_LIMIT) {
      announce(`This board already has ${BOARD_BOOKMARK_LIMIT} saved views. Remove one before adding another.`);
      return;
    }
    const label = normalizeBoardNavigationLabel(
      bookmarkName,
      `Bookmark ${bookmarks.length + 1}`,
    );
    const nextBookmark: BoardBookmark = {
      id: localBookmarkId(),
      label,
      camera: cameraLocation(editor),
      createdAt: Date.now(),
    };
    if (commitBookmarks([nextBookmark, ...bookmarks])) {
      setBookmarkName("");
      announce(`${label} saved on this device.`);
    }
  }, [
    announce,
    bookmarkName,
    bookmarks,
    commitBookmarks,
    editor,
    storageReady,
  ]);

  const visitBookmark = useCallback(
    (bookmark: BoardBookmark) => {
      if (!editor) return;
      rememberLocation();
      editor.setCamera(bookmark.camera, { animation: { duration: 220 } });
      announce(`Moved to ${bookmark.label}.`);
    },
    [announce, editor, rememberLocation],
  );

  const removeBookmark = useCallback(
    (bookmark: BoardBookmark) => {
      const nextBookmarks = bookmarks.filter((item) => item.id !== bookmark.id);
      if (commitBookmarks(nextBookmarks)) {
        announce(`${bookmark.label} removed.`);
      }
    },
    [announce, bookmarks, commitBookmarks],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <MapIcon
            className="size-4 h-lh shrink-0 fill-sky-blue-accent"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 className="font-medium">Board Navigation</h3>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              Find objects and move around without losing your place.
            </p>
          </div>
        </div>
        <Button
          tone="ghost"
          leading={
            <ArrowUturnLeftIcon
              className="size-4 shrink-0 fill-current"
              aria-hidden="true"
            />
          }
          disabled={!editor || !lastLocation}
          onClick={returnToLastLocation}
        >
          Return to Last View
          <span
            className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </Button>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="fabric-minimap-title">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="fabric-minimap-title" className="font-medium">
            Minimap
          </h3>
          <p className="tabular-nums text-base text-muted-gray sm:text-sm">
            {snapshot.totalObjects} {snapshot.totalObjects === 1 ? "Object" : "Objects"}
          </p>
        </div>
        <button
          type="button"
          aria-label="Move to an area on the board minimap"
          disabled={!editor}
          className="relative h-36 w-full overflow-hidden rounded-radius-lg bg-light-surface-tint outline-none ring-1 ring-near-black-primary-text/8 hover:ring-sky-blue-accent/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent disabled:pointer-events-none disabled:opacity-55"
          onClick={navigateFromMinimap}
        >
          <svg
            viewBox={`0 0 ${minimap.width} ${minimap.height}`}
            preserveAspectRatio="none"
            className="size-full"
            aria-hidden="true"
          >
            {minimap.shapes.map((shape) => (
              <rect
                key={shape.id}
                x={shape.x}
                y={shape.y}
                width={shape.w}
                height={shape.h}
                rx={1.5}
                className="fill-sky-blue-accent/15 stroke-sky-blue-accent/30"
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <rect
              x={minimap.viewport.x}
              y={minimap.viewport.y}
              width={minimap.viewport.w}
              height={minimap.viewport.h}
              rx={3}
              className="fill-surface-white/60 stroke-sky-blue-accent"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span
            className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
            aria-hidden="true"
          />
        </button>
        <p className="text-pretty text-base text-muted-gray sm:text-sm">
          Click the map to move while keeping your current zoom.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-near-black-primary-text/8 pt-4" aria-labelledby="fabric-object-outline-title">
        <div className="flex flex-col gap-2">
          <label htmlFor="fabric-board-object-search" className="font-medium">
            Search Objects
          </label>
          <div className="flex items-center gap-1 rounded-radius-lg bg-surface-white p-1 ring-1 ring-near-black-primary-text/10 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-sky-blue-accent">
            <MagnifyingGlassIcon
              className="size-4 shrink-0 fill-muted-gray"
              aria-hidden="true"
            />
            <input
              id="fabric-board-object-search"
              name="board-object-search"
              type="search"
              value={query}
              maxLength={120}
              autoComplete="off"
              placeholder="Search text, notes, frames, and shapes"
              disabled={!editor}
              className="h-10 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-gray disabled:opacity-55 sm:h-8 sm:text-sm"
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <IconButton label="Clear Object Search" onClick={() => setQuery("")}>
                <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-3">
          <h3 id="fabric-object-outline-title" className="font-medium">
            Outline
          </h3>
          <p className="tabular-nums text-base text-muted-gray sm:text-sm">
            {searchResult.total} {searchResult.total === 1 ? "Result" : "Results"}
          </p>
        </div>

        {snapshot.totalObjects > BOARD_NAVIGATION_INDEX_LIMIT ? (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            Showing the top {BOARD_NAVIGATION_INDEX_LIMIT.toLocaleString()} objects on this page.
          </p>
        ) : null}

        {searchResult.items.length ? (
          <ol role="list" className="divide-y divide-near-black-primary-text/8">
            {searchResult.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="relative flex min-h-12 w-full min-w-0 items-center gap-2.5 py-2 text-left outline-none hover:text-sky-blue-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-blue-accent sm:min-h-10"
                  onClick={() => navigateToObject(item)}
                >
                  <Square3Stack3DIcon
                    className="size-4 shrink-0 fill-muted-gray"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 truncate text-base font-medium sm:text-sm">
                    {item.label}
                  </div>
                  <div className="shrink-0 text-base text-muted-gray sm:text-sm">
                    {item.typeLabel}
                  </div>
                  <span
                    className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="rounded-radius-lg bg-light-surface-tint p-3">
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              {editor
                ? query
                  ? "No objects match that search. Try a label or object type."
                  : "No objects yet. Add something to the board to build an outline."
                : "The whiteboard is still loading. Object search will appear when it is ready."}
            </p>
          </div>
        )}

        {searchResult.total > searchResult.items.length ? (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            Refine the search to narrow the {searchResult.total.toLocaleString()} matching objects.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-near-black-primary-text/8 pt-4" aria-labelledby="fabric-board-bookmarks-title">
        <div className="flex min-w-0 items-start gap-2.5">
          <BookmarkIcon
            className="size-4 h-lh shrink-0 fill-sky-blue-accent"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h3 id="fabric-board-bookmarks-title" className="font-medium">
              Bookmarks
            </h3>
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              Save up to {BOARD_BOOKMARK_LIMIT} views on this device.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="fabric-board-bookmark-name" className="font-medium">
            Bookmark Name
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <input
              id="fabric-board-bookmark-name"
              name="board-bookmark-name"
              type="text"
              value={bookmarkName}
              maxLength={60}
              autoComplete="off"
              placeholder={`Bookmark ${bookmarks.length + 1}`}
              disabled={!editor || !storageReady || bookmarks.length >= BOARD_BOOKMARK_LIMIT}
              className="h-10 min-w-0 flex-1 rounded-radius-md bg-surface-white px-3 text-base outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent disabled:opacity-55 sm:h-8 sm:text-sm"
              onChange={(event) => setBookmarkName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  saveBookmark();
                }
              }}
            />
            <Button
              leading={
                <BookmarkIcon
                  className="size-4 shrink-0 fill-current"
                  aria-hidden="true"
                />
              }
              disabled={!editor || !storageReady || bookmarks.length >= BOARD_BOOKMARK_LIMIT}
              onClick={saveBookmark}
            >
              Save View
              <span
                className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                aria-hidden="true"
              />
            </Button>
          </div>
        </div>

        {bookmarks.length ? (
          <ul role="list" className="divide-y divide-near-black-primary-text/8">
            {bookmarks.map((bookmark) => (
              <li key={bookmark.id} className="flex min-w-0 items-center gap-1 py-1.5">
                <button
                  type="button"
                  className="relative flex min-h-12 min-w-0 flex-1 items-center gap-2.5 rounded-radius-md px-2 text-left outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:min-h-10"
                  onClick={() => visitBookmark(bookmark)}
                >
                  <BookmarkIcon
                    className="size-4 shrink-0 fill-muted-gray"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1 truncate text-base font-medium sm:text-sm">
                    {bookmark.label}
                  </div>
                  <span
                    className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                    aria-hidden="true"
                  />
                </button>
                <IconButton
                  label={`Remove ${bookmark.label} Bookmark`}
                  tooltipSide="top"
                  onClick={() => removeBookmark(bookmark)}
                >
                  <TrashIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-radius-lg bg-light-surface-tint p-3">
            <p className="text-pretty text-base text-muted-gray sm:text-sm">
              No bookmarks yet. Name the current view and save it for quick return.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
