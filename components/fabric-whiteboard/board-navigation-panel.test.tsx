// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createShapeId,
  toRichText,
  type Editor,
  type TLShape,
} from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  boardBookmarkStorageKey,
  parseBoardBookmarks,
} from "@/lib/boards/board-navigation";

import { FabricBoardNavigationPanel } from "./board-navigation-panel";

type Listener = () => void;

function createMockEditor() {
  const shapeId = createShapeId("cell-division");
  const shape = {
    id: shapeId,
    type: "text",
    props: { richText: toRichText("Cell Division") },
  } as unknown as TLShape;
  const listeners = new Map<string, Listener>();
  const disposers = new Map<string, ReturnType<typeof vi.fn>>();
  const getCurrentPageShapesSorted = vi.fn(() => [shape]);
  const getViewportPageBounds = vi.fn(() => ({ x: 100, y: 200, w: 900, h: 600 }));
  const getShapePageBounds = vi.fn(() => ({ x: 250, y: 300, w: 240, h: 80 }));
  const getCamera = vi.fn(() => ({ x: -100, y: -200, z: 1 }));
  const select = vi.fn();
  const zoomToBounds = vi.fn();
  const centerOnPoint = vi.fn();
  const setCamera = vi.fn();
  const listen = vi.fn((listener: Listener, filters: { scope?: string }) => {
    const scope = filters.scope ?? "all";
    const dispose = vi.fn();
    listeners.set(scope, listener);
    disposers.set(scope, dispose);
    return dispose;
  });
  const editor = {
    centerOnPoint,
    getCamera,
    getCurrentPageShapesSorted,
    getShape: vi.fn((id: string) => (id === shapeId ? shape : undefined)),
    getShapePageBounds,
    getTextOptions: () => ({}),
    getViewportPageBounds,
    select,
    setCamera,
    store: { listen },
    zoomToBounds,
  } as unknown as Editor;

  return {
    editor,
    listeners,
    disposers,
    mocks: {
      centerOnPoint,
      getCurrentPageShapesSorted,
      getViewportPageBounds,
      listen,
      select,
      setCamera,
      zoomToBounds,
    },
    shapeId,
  };
}

describe("Fabric board navigation panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function renderPanel(editor: Editor, onAnnouncement = vi.fn()) {
    act(() => {
      root.render(
        <FabricBoardNavigationPanel
          editor={editor}
          boardId="board-biology"
          onAnnouncement={onAnnouncement}
        />,
      );
    });
    return onAnnouncement;
  }

  function click(element: Element | null | undefined) {
    expect(element).toBeTruthy();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function buttonWithText(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(button).toBeDefined();
    return button!;
  }

  it("separates document indexing from a throttled viewport refresh", () => {
    vi.useFakeTimers();
    const mock = createMockEditor();
    renderPanel(mock.editor);

    expect(mock.mocks.listen).toHaveBeenCalledTimes(2);
    expect(mock.mocks.listen).toHaveBeenCalledWith(expect.any(Function), {
      source: "all",
      scope: "document",
    });
    expect(mock.mocks.listen).toHaveBeenCalledWith(expect.any(Function), {
      source: "all",
      scope: "session",
    });
    expect(mock.mocks.getCurrentPageShapesSorted).toHaveBeenCalledOnce();
    expect(mock.mocks.getViewportPageBounds).toHaveBeenCalledOnce();

    act(() => {
      mock.listeners.get("session")?.();
      mock.listeners.get("session")?.();
      vi.advanceTimersByTime(99);
    });
    expect(mock.mocks.getCurrentPageShapesSorted).toHaveBeenCalledOnce();
    expect(mock.mocks.getViewportPageBounds).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(1));
    expect(mock.mocks.getCurrentPageShapesSorted).toHaveBeenCalledOnce();
    expect(mock.mocks.getViewportPageBounds).toHaveBeenCalledTimes(2);

    act(() => {
      mock.listeners.get("document")?.();
      vi.advanceTimersByTime(119);
    });
    expect(mock.mocks.getCurrentPageShapesSorted).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1));
    expect(mock.mocks.getCurrentPageShapesSorted).toHaveBeenCalledTimes(2);
  });

  it("searches the live outline, navigates to an object, and returns", () => {
    const mock = createMockEditor();
    const announce = renderPanel(mock.editor);
    const objectButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes("Cell Division"));

    click(objectButton);
    expect(mock.mocks.select).toHaveBeenCalledWith(mock.shapeId);
    expect(mock.mocks.zoomToBounds).toHaveBeenCalledWith(
      { x: 250, y: 300, w: 240, h: 80 },
      {
        animation: { duration: 220 },
        inset: 80,
        targetZoom: 1,
      },
    );
    expect(announce).toHaveBeenCalledWith("Moved to Cell Division.");

    click(buttonWithText("Return to Last View"));
    expect(mock.mocks.setCamera).toHaveBeenCalledWith(
      { x: -100, y: -200, z: 1 },
      { animation: { duration: 220 } },
    );
  });

  it("saves bounded board-scoped bookmarks in local storage", () => {
    vi.useFakeTimers();
    const mock = createMockEditor();
    const announce = renderPanel(mock.editor);
    act(() => vi.advanceTimersByTime(0));
    const input = container.querySelector<HTMLInputElement>(
      "#fabric-board-bookmark-name",
    );
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    act(() => {
      valueSetter?.call(input, "Biology Overview");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(buttonWithText("Save View"));

    const stored = parseBoardBookmarks(
      window.localStorage.getItem(boardBookmarkStorageKey("board-biology")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      label: "Biology Overview",
      camera: { x: -100, y: -200, z: 1 },
    });
    expect(container.textContent).toContain("Biology Overview");
    expect(announce).toHaveBeenCalledWith(
      "Biology Overview saved on this device.",
    );
  });

  it("unsubscribes both scoped listeners when the panel unmounts", () => {
    const mock = createMockEditor();
    renderPanel(mock.editor);

    act(() => root.unmount());

    expect(mock.disposers.get("document")).toHaveBeenCalledOnce();
    expect(mock.disposers.get("session")).toHaveBeenCalledOnce();
  });
});
