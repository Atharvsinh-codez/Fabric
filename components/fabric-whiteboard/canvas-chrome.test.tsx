// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tldrawMocks = vi.hoisted(() => {
  const colorStyle = { id: "color" };
  return {
    colorStyle,
    relevantStyles: new Map<unknown, unknown>([
      [colorStyle, { type: "shared", value: "blue" }],
    ]),
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
    useRelevantStyles: () => tldrawMocks.relevantStyles,
  };
});

import {
  FABRIC_CANVAS_TOOL_ORDER,
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
});
