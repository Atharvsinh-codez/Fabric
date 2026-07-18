// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tldrawMocks = vi.hoisted(() => {
  const colorStyle = { id: "color" };
  return {
    colorStyle,
    documentMeta: {} as Record<string, unknown>,
    camera: { x: 2, y: 3, z: 2 },
    relevantStyles: new Map<unknown, unknown>([
      [colorStyle, { type: "shared", value: "blue" }],
    ]),
    editor: {
      getDocumentSettings: () => ({
        gridSize: 10,
        meta: tldrawMocks.documentMeta,
      }),
      getCamera: () => tldrawMocks.camera,
      options: {
        gridSteps: [
          { min: -1, mid: 0.15, step: 4 },
          { min: 0.7, mid: 2.5, step: 1 },
        ],
      },
    },
  };
});

vi.mock("tldraw", async () => {
  const React = await import("react");

  return {
    DefaultColorStyle: tldrawMocks.colorStyle,
    DefaultStylePanel: ({
      children,
      isMobile,
    }: {
      children?: ReactNode;
      isMobile?: boolean;
    }) => React.createElement(
      "section",
      {
        "data-testid": "default-style-panel",
        "data-mobile": isMobile ? "true" : "false",
      },
      children,
    ),
    DefaultToolbar: ({
      children,
      orientation,
      minItems,
      minSizePx,
      maxItems,
      maxSizePx,
    }: {
      children?: ReactNode;
      orientation?: string;
      minItems?: number;
      minSizePx?: number;
      maxItems?: number;
      maxSizePx?: number;
    }) => React.createElement(
      "div",
      {
        "data-testid": "default-toolbar",
        "data-orientation": orientation,
        "data-min-items": minItems,
        "data-min-size-px": minSizePx,
        "data-max-items": maxItems,
        "data-max-size-px": maxSizePx,
      },
      children,
    ),
    StylePanelColorPicker: () => React.createElement(
      "button",
      { "data-testid": "style-color" },
      "Color",
    ),
    StylePanelSection: ({ children }: { children?: ReactNode }) => React.createElement(
      "div",
      { "data-testid": "style-section" },
      children,
    ),
    ToolbarItem: ({ tool }: { tool: string }) => React.createElement(
      "button",
      { "data-tool": tool },
      tool,
    ),
    suffixSafeId: (id: string, suffix: string) => `${id}_${suffix}`,
    useEditor: () => tldrawMocks.editor,
    useRelevantStyles: () => tldrawMocks.relevantStyles,
    useUniqueSafeId: () => "fabric-theme",
    useValue: (_name: string, read: () => unknown) => read(),
  };
});

import {
  FABRIC_CANVAS_TOOL_ORDER,
  FabricCanvasBackground,
  FabricCanvasToolbar,
  FabricColorStylePanel,
  fabricCanvasComponents,
} from "./canvas-chrome";

const STOCK_TLDRAW_4_2_TOOL_IDS = [
  "select",
  "hand",
  "draw",
  "eraser",
  "arrow",
  "text",
  "note",
  "asset",
  "rectangle",
  "ellipse",
  "triangle",
  "diamond",
  "hexagon",
  "oval",
  "rhombus",
  "star",
  "cloud",
  "heart",
  "x-box",
  "check-box",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "arrow-right",
  "line",
  "highlight",
  "laser",
  "frame",
] as const;

describe("Fabric canvas chrome", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    tldrawMocks.relevantStyles = new Map([
      [tldrawMocks.colorStyle, { type: "shared", value: "blue" }],
    ]);
    tldrawMocks.documentMeta = {};
    tldrawMocks.camera = { x: 2, y: 3, z: 2 };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("promotes core geometry while preserving every stock toolbar tool exactly once", () => {
    act(() => root.render(<FabricCanvasToolbar />));

    const dock = container.querySelector<HTMLElement>(
      '[data-testid="fabric-canvas-tool-dock"]',
    );
    const toolbar = container.querySelector<HTMLElement>(
      '[data-testid="default-toolbar"]',
    );
    const renderedTools = [...container.querySelectorAll<HTMLElement>("[data-tool]")]
      .map((item) => item.dataset.tool);

    expect(dock?.dataset.placement).toBe("center");
    expect(toolbar?.dataset).toMatchObject({
      orientation: "horizontal",
      minItems: "4",
      minSizePx: "300",
      maxItems: "10",
      maxSizePx: "520",
    });
    expect(renderedTools).toEqual(FABRIC_CANVAS_TOOL_ORDER);
    expect(new Set(renderedTools).size).toBe(FABRIC_CANVAS_TOOL_ORDER.length);
    expect([...renderedTools].sort()).toEqual([...STOCK_TLDRAW_4_2_TOOL_IDS].sort());
    expect(renderedTools.slice(0, 12)).toEqual([
      "select",
      "hand",
      "rectangle",
      "ellipse",
      "draw",
      "eraser",
      "triangle",
      "diamond",
      "arrow",
      "text",
      "note",
      "asset",
    ]);
    expect(fabricCanvasComponents.Toolbar).toBe(FabricCanvasToolbar);
  });

  it("renders the same color-only style content for desktop and mobile", () => {
    act(() => root.render(<FabricColorStylePanel />));
    expect(container.querySelectorAll('[data-testid="style-section"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="style-color"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="default-style-panel"]')?.getAttribute("data-mobile"),
    ).toBe("false");

    act(() => root.render(<FabricColorStylePanel isMobile />));
    expect(container.querySelectorAll('[data-testid="style-color"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-testid="default-style-panel"]')?.getAttribute("data-mobile"),
    ).toBe("true");
    expect(fabricCanvasComponents.StylePanel).toBe(FabricColorStylePanel);
  });

  it("does not leave an empty style rail for shapes without a color style", () => {
    tldrawMocks.relevantStyles = new Map();
    act(() => root.render(<FabricColorStylePanel />));
    expect(container.innerHTML).toBe("");
  });

  it("keeps the current white canvas as the default background", () => {
    act(() => root.render(<FabricCanvasBackground />));

    const background = container.querySelector<HTMLElement>(".tl-background");
    expect(background?.dataset).toMatchObject({
      boardTheme: "canvas",
      boardThemePattern: "none",
    });
    expect(background?.style.backgroundColor).toBe("#ffffff");
    expect(container.querySelector(".tl-grid")).toBeNull();
    expect(fabricCanvasComponents.Background).toBe(FabricCanvasBackground);
    expect(fabricCanvasComponents.Grid).toBeNull();
  });

  it("renders shared grid and dot themes against the live camera without enabling tldraw grid mode", () => {
    tldrawMocks.documentMeta = { fabricBoardTheme: "grid" };
    act(() => root.render(<FabricCanvasBackground />));

    const background = container.querySelector<HTMLElement>(".tl-background");
    expect(background?.dataset.boardTheme).toBe("grid");
    expect(container.querySelectorAll("pattern")).toHaveLength(2);
    expect(container.querySelectorAll("pattern path")).toHaveLength(2);
    expect(container.querySelector('pattern[width="20"]')).not.toBeNull();

    tldrawMocks.documentMeta = { fabricBoardTheme: "sage" };
    act(() => root.render(<FabricCanvasBackground />));
    expect(
      container.querySelector<HTMLElement>(".tl-background")?.dataset.boardTheme,
    ).toBe("sage");
    expect(container.querySelectorAll("pattern circle")).toHaveLength(2);
    expect(container.querySelectorAll("pattern path")).toHaveLength(0);
  });
});
