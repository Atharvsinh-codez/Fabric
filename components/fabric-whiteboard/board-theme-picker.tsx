"use client";

import { SwatchIcon } from "@heroicons/react/16/solid";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { type TLDocument, useValue } from "tldraw";

import { IconButton, cx } from "@/components/ui";
import {
  BOARD_THEMES,
  BOARD_THEME_PRESETS,
  DEFAULT_BOARD_THEME,
  mergeBoardThemeMeta,
  readBoardThemeFromMeta,
  type BoardTheme,
  type BoardThemePreset,
} from "@/lib/boards/board-theme";

const THEME_PANEL_WIDTH = 288;
const THEME_PANEL_ESTIMATED_HEIGHT = 240;
const THEME_PANEL_GAP = 8;
const THEME_PANEL_VIEWPORT_GUTTER = 8;

type ThemePanelPosition = Readonly<{
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}>;

type ThemePanelStyle = CSSProperties & {
  "--theme-panel-left": string;
  "--theme-panel-top": string;
  "--theme-panel-width": string;
  "--theme-panel-max-height": string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function measureThemePanel(trigger: DOMRect): ThemePanelPosition {
  const viewportWidth = Math.max(0, window.innerWidth);
  const viewportHeight = Math.max(0, window.innerHeight);
  const width = Math.max(
    0,
    Math.min(
      THEME_PANEL_WIDTH,
      viewportWidth - THEME_PANEL_VIEWPORT_GUTTER * 2,
    ),
  );
  const maximumLeft = Math.max(
    THEME_PANEL_VIEWPORT_GUTTER,
    viewportWidth - width - THEME_PANEL_VIEWPORT_GUTTER,
  );
  const left = clamp(
    trigger.right - width,
    THEME_PANEL_VIEWPORT_GUTTER,
    maximumLeft,
  );
  const belowTop = trigger.bottom + THEME_PANEL_GAP;
  const aboveBottom = trigger.top - THEME_PANEL_GAP;
  const availableBelow = Math.max(
    0,
    viewportHeight - belowTop - THEME_PANEL_VIEWPORT_GUTTER,
  );
  const availableAbove = Math.max(
    0,
    aboveBottom - THEME_PANEL_VIEWPORT_GUTTER,
  );
  const opensAbove =
    THEME_PANEL_ESTIMATED_HEIGHT > availableBelow &&
    availableAbove > availableBelow;
  const maxHeight = opensAbove ? availableAbove : availableBelow;
  const top = opensAbove
    ? Math.max(
        THEME_PANEL_VIEWPORT_GUTTER,
        aboveBottom - Math.min(THEME_PANEL_ESTIMATED_HEIGHT, availableAbove),
      )
    : Math.max(THEME_PANEL_VIEWPORT_GUTTER, belowTop);

  return { left, top, width, maxHeight };
}

function themePanelStyle(position: ThemePanelPosition): ThemePanelStyle {
  return {
    "--theme-panel-left": `${position.left}px`,
    "--theme-panel-top": `${position.top}px`,
    "--theme-panel-width": `${position.width}px`,
    "--theme-panel-max-height": `${position.maxHeight}px`,
  };
}

function previewStyle(preset: BoardThemePreset): CSSProperties {
  if (preset.pattern === "dots") {
    return {
      backgroundColor: preset.background,
      backgroundImage: `radial-gradient(circle, ${preset.patternColor} 1px, transparent 1.25px)`,
      backgroundPosition: "center",
      backgroundSize: "8px 8px",
    };
  }
  if (preset.pattern === "grid") {
    return {
      backgroundColor: preset.background,
      backgroundImage: `linear-gradient(${preset.patternColor} 1px, transparent 1px), linear-gradient(90deg, ${preset.patternColor} 1px, transparent 1px)`,
      backgroundPosition: "center",
      backgroundSize: "10px 10px",
    };
  }
  return { backgroundColor: preset.background };
}

export function FabricBoardThemePicker({
  editor,
  disabled = false,
}: {
  editor: BoardThemeEditor | null;
  disabled?: boolean;
}) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<ThemePanelPosition>({
    left: THEME_PANEL_VIEWPORT_GUTTER,
    top: 56,
    width: THEME_PANEL_WIDTH,
    maxHeight: THEME_PANEL_ESTIMATED_HEIGHT,
  });
  const isOpen = open && Boolean(editor) && !disabled;
  const selectedTheme = useValue(
    "fabric board theme picker",
    () =>
      editor
        ? (readBoardThemeFromMeta(editor.getDocumentSettings().meta) ??
          DEFAULT_BOARD_THEME)
        : DEFAULT_BOARD_THEME,
    [editor],
  );

  useEffect(() => {
    if (!isOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
  }, [isOpen]);

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPanelPosition(measureThemePanel(trigger.getBoundingClientRect()));
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    window.visualViewport?.addEventListener("resize", updatePanelPosition);
    window.visualViewport?.addEventListener("scroll", updatePanelPosition);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.visualViewport?.removeEventListener("resize", updatePanelPosition);
      window.visualViewport?.removeEventListener("scroll", updatePanelPosition);
    };
  }, [isOpen, updatePanelPosition]);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[aria-pressed="true"]`)
      ?.focus();
  }, [isOpen]);

  const selectTheme = (theme: BoardTheme) => {
    if (!editor || disabled || theme === selectedTheme) return;
    editor.updateDocumentSettings({
      meta: mergeBoardThemeMeta(editor.getDocumentSettings().meta, theme),
    });
  };

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <IconButton
        ref={triggerRef}
        label="Board Theme"
        active={isOpen}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-expanded={isOpen}
        data-suppress-tooltip-when-expanded="true"
        disabled={disabled || !editor}
        onClick={() => {
          if (isOpen) {
            setOpen(false);
            return;
          }
          updatePanelPosition();
          setOpen(true);
        }}
      >
        <SwatchIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
      </IconButton>

      {isOpen
        ? createPortal(
            <section
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label="Choose board theme"
              style={themePanelStyle(panelPosition)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className="review-panel-enter floating-shadow fixed top-(--theme-panel-top) left-(--theme-panel-left) z-1100 max-h-(--theme-panel-max-height) w-(--theme-panel-width) overflow-y-auto overscroll-contain rounded-radius-xl bg-surface-white p-3 ring-1 ring-near-black-primary-text/10 motion-reduce:animate-none"
            >
              <div className="flex flex-col gap-0.5 px-1 pb-2.5">
                <h2 className="text-base font-medium sm:text-sm">Board theme</h2>
                <p className="text-base text-muted-gray sm:text-sm">
                  Shared with everyone on this board.
                </p>
              </div>
              <ul role="list" className="grid grid-cols-3 gap-1.5">
                {BOARD_THEMES.map((theme) => {
                  const preset = BOARD_THEME_PRESETS[theme];
                  const selected = theme === selectedTheme;
                  return (
                    <li key={theme}>
                      <button
                        type="button"
                        aria-label={`Use ${preset.label} board theme`}
                        aria-pressed={selected}
                        onClick={() => selectTheme(theme)}
                        className={cx(
                          "relative flex min-h-16 w-full flex-col gap-1 rounded-radius-lg p-1.5 text-left outline-none",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent",
                          selected
                            ? "bg-(--accent-soft) text-near-black-primary-text ring-1 ring-sky-blue-accent"
                            : "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text active:bg-light-surface-tint",
                        )}
                      >
                        <span
                          className="h-8 w-full rounded-radius-md ring-1 ring-near-black-primary-text/10"
                          style={previewStyle(preset)}
                          aria-hidden="true"
                        />
                        <span className="w-full truncate px-0.5 text-center">
                          {preset.label}
                        </span>
                        <span
                          className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
                          aria-hidden="true"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>,
            document.body,
          )
        : null}
    </div>
  );
}

export type BoardThemeEditor = Readonly<{
  getDocumentSettings: () => Pick<TLDocument, "meta">;
  updateDocumentSettings: (
    settings: Readonly<Pick<TLDocument, "meta">>,
  ) => unknown;
}>;
