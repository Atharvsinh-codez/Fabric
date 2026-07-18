"use client";

import {
  DefaultColorStyle,
  DefaultStylePanel,
  DefaultToolbar,
  StylePanelColorPicker,
  StylePanelSection,
  ToolbarItem,
  suffixSafeId,
  type TLComponents,
  type TLUiStylePanelProps,
  useEditor,
  useRelevantStyles,
  useUniqueSafeId,
  useValue,
} from "tldraw";

import {
  BOARD_THEME_PRESETS,
  DEFAULT_BOARD_THEME,
  readBoardThemeFromMeta,
} from "@/lib/boards/board-theme";

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
      data-placement="center"
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

function gridOpacity(zoom: number, min: number, mid: number): number {
  if (zoom >= mid) return 1;
  if (zoom <= min) return 0;
  return (zoom - min) / (mid - min);
}

/**
 * Board themes live in tldraw's shared document metadata. Rendering them in a
 * public Background slot keeps the pattern visual-only: grid themes never
 * enable tldraw's snapping mode or alter shape behavior.
 */
export function FabricCanvasBackground() {
  const editor = useEditor();
  const patternId = useUniqueSafeId("fabric-board-theme");
  const { theme, gridSize } = useValue(
    "fabric board theme background",
    () => {
      const settings = editor.getDocumentSettings();
      return {
        theme: readBoardThemeFromMeta(settings.meta) ?? DEFAULT_BOARD_THEME,
        gridSize: settings.gridSize,
      };
    },
    [editor],
  );
  const camera = useValue(
    "fabric board theme camera",
    () => editor.getCamera(),
    [editor],
  );
  const preset = BOARD_THEME_PRESETS[theme];
  const gridSteps = editor.options.gridSteps;

  return (
    <div
      className="tl-background"
      data-board-theme={theme}
      data-board-theme-pattern={preset.pattern}
      style={{ backgroundColor: preset.background }}
    >
      {preset.pattern === "none" ? null : (
        <svg
          className="tl-grid"
          version="1.1"
          aria-hidden="true"
        >
          <defs>
            {gridSteps.map(({ min, mid, step }) => {
              const spacing = step * Math.max(1, gridSize) * camera.z;
              const xOrigin = 0.5 + camera.x * camera.z;
              const yOrigin = 0.5 + camera.y * camera.z;
              const gridX = xOrigin > 0
                ? xOrigin % spacing
                : spacing + (xOrigin % spacing);
              const gridY = yOrigin > 0
                ? yOrigin % spacing
                : spacing + (yOrigin % spacing);
              const opacity = gridOpacity(camera.z, min, mid);
              const id = suffixSafeId(patternId, `${preset.pattern}-${step}`);

              return (
                <pattern
                  key={step}
                  id={id}
                  width={spacing}
                  height={spacing}
                  patternUnits="userSpaceOnUse"
                >
                  {preset.pattern === "dots" ? (
                    <circle
                      cx={gridX}
                      cy={gridY}
                      r={1}
                      fill={preset.patternColor}
                      opacity={opacity}
                    />
                  ) : (
                    <path
                      d={`M ${gridX} 0 V ${spacing} M 0 ${gridY} H ${spacing}`}
                      fill="none"
                      stroke={preset.patternColor}
                      strokeWidth={1}
                      opacity={opacity}
                    />
                  )}
                </pattern>
              );
            })}
          </defs>
          {gridSteps.map(({ step }) => {
            const id = suffixSafeId(patternId, `${preset.pattern}-${step}`);
            return (
              <rect
                key={step}
                width="100%"
                height="100%"
                fill={`url(#${id})`}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

export const fabricCanvasComponents = {
  Background: FabricCanvasBackground,
  // Decorative board patterns are rendered by FabricCanvasBackground. Keep
  // tldraw's session grid disabled so themes never switch on snap-to-grid.
  Grid: null,
  MenuPanel: null,
  NavigationPanel: null,
  HelperButtons: null,
  Toolbar: FabricCanvasToolbar,
  StylePanel: FabricColorStylePanel,
} satisfies TLComponents;
