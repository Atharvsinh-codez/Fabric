"use client";

import {
  DefaultColorStyle,
  DefaultStylePanel,
  DefaultToolbar,
  StylePanelColorPicker,
  StylePanelSection,
  ToolbarItem,
  type TLComponents,
  type TLUiStylePanelProps,
  useRelevantStyles,
} from "tldraw";

/**
 * Keep every tool exposed by tldraw's stock 4.2.0 toolbar, while putting the
 * everyday drawing and geometry tools before the responsive overflow.
 */
export const FABRIC_CANVAS_TOOL_ORDER = [
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
  "line",
  "highlight",
  "frame",
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
  "laser",
] as const;

export function FabricCanvasToolbar() {
  return (
    <div
      className="fabric-canvas-tool-dock"
      data-testid="fabric-canvas-tool-dock"
    >
      <DefaultToolbar
        orientation="horizontal"
        minItems={4}
        minSizePx={300}
        maxItems={10}
        maxSizePx={520}
      >
        {FABRIC_CANVAS_TOOL_ORDER.map((tool) => (
          <ToolbarItem key={tool} tool={tool} />
        ))}
      </DefaultToolbar>
    </div>
  );
}

export function FabricColorStylePanel({
  isMobile = false,
  styles,
}: TLUiStylePanelProps) {
  const relevantStyles = useRelevantStyles([DefaultColorStyle]);
  const colorStyles = styles === undefined ? relevantStyles : styles;

  if (!colorStyles || colorStyles.get(DefaultColorStyle) === undefined) {
    return null;
  }

  return (
    <div
      className="fabric-canvas-color-panel"
      data-mobile={isMobile ? "true" : "false"}
      data-testid="fabric-canvas-color-panel"
    >
      <DefaultStylePanel isMobile={isMobile} styles={colorStyles}>
        <StylePanelSection>
          <StylePanelColorPicker />
        </StylePanelSection>
      </DefaultStylePanel>
    </div>
  );
}

export const fabricCanvasComponents = {
  MenuPanel: null,
  NavigationPanel: null,
  HelperButtons: null,
  Toolbar: FabricCanvasToolbar,
  StylePanel: FabricColorStylePanel,
} satisfies TLComponents;
