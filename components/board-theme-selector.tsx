"use client";

import { CheckCircleIcon } from "@heroicons/react/16/solid";
import type { CSSProperties } from "react";

import { cx } from "@/components/ui";
import {
  BOARD_THEMES,
  BOARD_THEME_PRESETS,
  type BoardTheme,
  type BoardThemePattern,
} from "@/lib/boards/board-theme";

type ThemePreviewStyle = CSSProperties & {
  "--theme-background": string;
  "--theme-pattern": string;
};

function themePatternClass(pattern: BoardThemePattern): string {
  if (pattern === "grid") {
    return "[background-image:linear-gradient(var(--theme-pattern)_1px,transparent_1px),linear-gradient(90deg,var(--theme-pattern)_1px,transparent_1px)] [background-size:14px_14px]";
  }
  if (pattern === "dots") {
    return "[background-image:radial-gradient(circle,var(--theme-pattern)_1px,transparent_1.25px)] [background-size:12px_12px]";
  }
  return "";
}

export function BoardThemePreview({
  theme,
  className,
}: {
  theme: BoardTheme;
  className?: string;
}) {
  const preset = BOARD_THEME_PRESETS[theme];
  const previewStyle: ThemePreviewStyle = {
    "--theme-background": preset.background,
    "--theme-pattern": preset.patternColor,
  };

  return (
    <span
      aria-hidden="true"
      className={cx(
        "relative flex overflow-hidden bg-(--theme-background) ring-1 ring-inset ring-near-black-primary-text/7",
        className,
      )}
      style={previewStyle}
    >
      <span
        className={cx(
          "absolute inset-0",
          themePatternClass(preset.pattern),
        )}
      />
    </span>
  );
}

export function BoardThemeSelector({
  value,
  onChange,
  name,
  legend = "Board theme",
  disabled = false,
}: {
  value: BoardTheme;
  onChange: (theme: BoardTheme) => void;
  name: string;
  legend?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {BOARD_THEMES.map((theme) => {
          const preset = BOARD_THEME_PRESETS[theme];
          const selected = value === theme;

          return (
            <label
              key={theme}
              data-board-theme-option={theme}
              data-selected={selected ? "true" : "false"}
              className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-radius-lg bg-surface-white p-2 ring-1 ring-near-black-primary-text/8 outline-none hover:bg-light-surface-tint has-checked:bg-sky-blue-accent/7 has-checked:ring-2 has-checked:ring-sky-blue-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-sky-blue-accent has-disabled:cursor-not-allowed has-disabled:opacity-55"
            >
              <input
                type="radio"
                name={name}
                value={theme}
                checked={selected}
                onChange={() => onChange(theme)}
                className="sr-only"
              />
              <span className="relative">
                <BoardThemePreview
                  theme={theme}
                  className="aspect-[8/5] w-full rounded-radius-md"
                />
                {selected ? (
                  <CheckCircleIcon
                    className="absolute top-1.5 right-1.5 size-4 fill-sky-blue-accent [filter:drop-shadow(0_1px_1px_rgb(255_255_255/0.9))]"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              <p className="truncate px-0.5 text-base font-medium sm:text-sm">
                {preset.label}
              </p>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
