export const BOARD_THEMES = [
  "canvas",
  "dots",
  "grid",
  "sage",
  "sky",
  "sand",
] as const;

export type BoardTheme = (typeof BOARD_THEMES)[number];

/** Preserve the original white canvas for legacy documents with no theme. */
export const DEFAULT_BOARD_THEME: BoardTheme = "canvas";
/** Start every newly created board with Fabric's multi-scale grid canvas. */
export const DEFAULT_NEW_BOARD_THEME: BoardTheme = "grid";
export const BOARD_THEME_META_KEY = "fabricBoardTheme" as const;

export type BoardThemePattern = "none" | "dots" | "grid";

export type BoardThemePreset = Readonly<{
  label: string;
  background: string;
  pattern: BoardThemePattern;
  patternColor: string;
}>;

export const BOARD_THEME_PRESETS = {
  canvas: {
    label: "Canvas",
    background: "#ffffff",
    pattern: "none",
    patternColor: "transparent",
  },
  dots: {
    label: "Dots",
    background: "#fbfcfe",
    pattern: "dots",
    patternColor: "rgba(100, 116, 139, 0.28)",
  },
  grid: {
    label: "Grid",
    background: "#fbfcfe",
    pattern: "grid",
    patternColor: "rgba(100, 116, 139, 0.18)",
  },
  sage: {
    label: "Sage",
    background: "#f2f7f1",
    pattern: "dots",
    patternColor: "rgba(73, 107, 79, 0.22)",
  },
  sky: {
    label: "Sky",
    background: "#f3f8fc",
    pattern: "grid",
    patternColor: "rgba(72, 126, 167, 0.18)",
  },
  sand: {
    label: "Sand",
    background: "#fbf7ed",
    pattern: "dots",
    patternColor: "rgba(145, 111, 66, 0.2)",
  },
} as const satisfies Readonly<Record<BoardTheme, BoardThemePreset>>;

const boardThemeSet = new Set<string>(BOARD_THEMES);

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBoardTheme(value: unknown): value is BoardTheme {
  return typeof value === "string" && boardThemeSet.has(value);
}

export function parseBoardTheme(value: unknown): BoardTheme {
  return isBoardTheme(value) ? value : DEFAULT_BOARD_THEME;
}

export function parseNewBoardTheme(value: unknown): BoardTheme {
  return isBoardTheme(value) ? value : DEFAULT_NEW_BOARD_THEME;
}

export function readBoardThemeFromMeta(meta: unknown): BoardTheme | null {
  if (!isJsonObject(meta)) return null;
  const theme = meta[BOARD_THEME_META_KEY];
  return isBoardTheme(theme) ? theme : null;
}

export function mergeBoardThemeMeta<T extends Readonly<Record<string, unknown>>>(
  meta: T,
  theme: BoardTheme,
): T & Readonly<Record<typeof BOARD_THEME_META_KEY, BoardTheme>> {
  return { ...meta, [BOARD_THEME_META_KEY]: theme };
}
