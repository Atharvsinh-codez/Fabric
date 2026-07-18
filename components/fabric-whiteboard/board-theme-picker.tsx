"use client";

import { SwatchIcon } from "@heroicons/react/16/solid";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
  const [open, setOpen] = useState(false);
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
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeFromOutside);
    return () => document.removeEventListener("pointerdown", closeFromOutside);
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
        label="Board Theme"
        active={isOpen}
        aria-haspopup="dialog"
        aria-controls={panelId}
        aria-expanded={isOpen}
        disabled={disabled || !editor}
        onClick={() => setOpen((current) => !current)}
      >
        <SwatchIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
      </IconButton>

      {isOpen ? (
        <section
          id={panelId}
          role="dialog"
          aria-label="Choose board theme"
          className="floating-shadow fixed inset-x-2 top-14 z-1100 w-auto rounded-radius-xl bg-surface-white p-3 ring-1 ring-near-black-primary-text/10 sm:absolute sm:inset-x-auto sm:top-10 sm:right-0 sm:w-72"
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
        </section>
      ) : null}
    </div>
  );
}

export type BoardThemeEditor = Readonly<{
  getDocumentSettings: () => Pick<TLDocument, "meta">;
  updateDocumentSettings: (
    settings: Readonly<Pick<TLDocument, "meta">>,
  ) => unknown;
}>;
