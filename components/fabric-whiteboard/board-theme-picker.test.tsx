// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLDocument } from "tldraw";

vi.mock("tldraw", () => ({
  useValue: (_name: string, read: () => unknown) => read(),
}));

import { FabricBoardThemePicker } from "./board-theme-picker";

function themeEditor(initialTheme?: string) {
  let meta: TLDocument["meta"] = {
    preserved: "value",
    ...(initialTheme ? { fabricBoardTheme: initialTheme } : {}),
  };
  const updateDocumentSettings = vi.fn((settings: Pick<TLDocument, "meta">) => {
    meta = settings.meta;
  });
  return {
    editor: {
      getDocumentSettings: () => ({ meta }),
      updateDocumentSettings,
    },
    readMeta: () => meta,
    updateDocumentSettings,
  };
}

describe("Fabric board theme picker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let initialInnerWidth: number;
  let initialInnerHeight: number;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    initialInnerWidth = window.innerWidth;
    initialInnerHeight = window.innerHeight;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: initialInnerWidth,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: initialInnerHeight,
    });
    vi.clearAllMocks();
  });

  it("opens a compact six-theme chooser with Canvas selected by default", () => {
    const { editor } = themeEditor();
    act(() => root.render(<FabricBoardThemePicker editor={editor} />));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Board Theme"]',
    );
    act(() => trigger?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.dataset.suppressTooltipWhenExpanded).toBe("true");
    expect(
      document.body.querySelector(
        '[role="dialog"][aria-label="Choose board theme"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelectorAll(
        'button[aria-label^="Use "][aria-label$=" board theme"]',
      ),
    ).toHaveLength(6);
    expect(
      document.body
        .querySelector('[aria-label="Use Canvas board theme"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(document.body.textContent).toContain(
      "Shared with everyone on this board.",
    );
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Use Canvas board theme",
    );
  });

  it("writes the shared theme without discarding other document metadata", () => {
    const model = themeEditor();
    act(() => root.render(<FabricBoardThemePicker editor={model.editor} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Board Theme"]')?.click());
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Use Sage board theme"]')
        ?.click(),
    );

    expect(model.updateDocumentSettings).toHaveBeenCalledOnce();
    expect(model.readMeta()).toEqual({
      preserved: "value",
      fabricBoardTheme: "sage",
    });
  });

  it("is disabled until the editor is mounted", () => {
    act(() => root.render(<FabricBoardThemePicker editor={null} />));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Board Theme"]',
    );
    expect(trigger?.disabled).toBe(true);
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("portals and clamps the chooser inside a narrow viewport", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 240,
    });
    const { editor } = themeEditor();
    act(() => root.render(<FabricBoardThemePicker editor={editor} />));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Board Theme"]',
    );
    const getTriggerBounds = vi
      .spyOn(trigger!, "getBoundingClientRect")
      .mockReturnValue({
        x: 0,
        y: 16,
        top: 16,
        right: 40,
        bottom: 48,
        left: 0,
        width: 40,
        height: 32,
        toJSON: () => ({}),
      });

    act(() => trigger?.click());

    const panel = document.body.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Choose board theme"]',
    );
    expect(panel?.parentElement).toBe(document.body);
    expect(panel?.style.getPropertyValue("--theme-panel-left")).toBe("8px");
    expect(panel?.style.getPropertyValue("--theme-panel-width")).toBe("288px");
    expect(panel?.style.getPropertyValue("--theme-panel-top")).toBe("56px");
    expect(panel?.style.getPropertyValue("--theme-panel-max-height")).toBe(
      "176px",
    );

    getTriggerBounds.mockReturnValue({
      x: 278,
      y: 16,
      top: 16,
      right: 318,
      bottom: 48,
      left: 278,
      width: 40,
      height: 32,
      toJSON: () => ({}),
    });
    act(() => window.dispatchEvent(new Event("resize")));
    expect(panel?.style.getPropertyValue("--theme-panel-left")).toBe("24px");
  });

  it("closes with Escape and restores focus to the theme control", () => {
    const { editor } = themeEditor();
    act(() => root.render(<FabricBoardThemePicker editor={editor} />));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Board Theme"]',
    );
    act(() => trigger?.click());
    const selectedTheme = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="Use Canvas board theme"]',
    );

    act(() =>
      selectedTheme?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});
