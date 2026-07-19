import { describe, expect, it } from "vitest";

import {
  BOARD_THEME_META_KEY,
  BOARD_THEME_PRESETS,
  BOARD_THEMES,
  DEFAULT_BOARD_THEME,
  DEFAULT_NEW_BOARD_THEME,
  mergeBoardThemeMeta,
  parseBoardTheme,
  parseNewBoardTheme,
  readBoardThemeFromMeta,
} from "./board-theme";

describe("board theme contract", () => {
  it("keeps every persisted theme aligned with a complete visual preset", () => {
    expect(Object.keys(BOARD_THEME_PRESETS)).toEqual([...BOARD_THEMES]);
    for (const theme of BOARD_THEMES) {
      expect(BOARD_THEME_PRESETS[theme]).toMatchObject({
        label: expect.any(String),
        background: expect.any(String),
        pattern: expect.stringMatching(/^(none|dots|grid)$/),
        patternColor: expect.any(String),
      });
    }
  });

  it("falls back safely for absent or unsupported persisted values", () => {
    expect(parseBoardTheme("sage")).toBe("sage");
    expect(parseBoardTheme("unknown-theme")).toBe(DEFAULT_BOARD_THEME);
    expect(parseBoardTheme(null)).toBe(DEFAULT_BOARD_THEME);
    expect(readBoardThemeFromMeta({ [BOARD_THEME_META_KEY]: "grid" })).toBe("grid");
    expect(readBoardThemeFromMeta({ [BOARD_THEME_META_KEY]: "unsafe" })).toBeNull();
    expect(readBoardThemeFromMeta([])).toBeNull();
  });

  it("uses Grid for new boards without changing the legacy Canvas fallback", () => {
    expect(DEFAULT_NEW_BOARD_THEME).toBe("grid");
    expect(parseNewBoardTheme(undefined)).toBe("grid");
    expect(parseNewBoardTheme("canvas")).toBe("canvas");
    expect(DEFAULT_BOARD_THEME).toBe("canvas");
  });

  it("merges the Fabric key without replacing unrelated document metadata", () => {
    expect(mergeBoardThemeMeta({ source: "lesson", nested: { version: 2 } }, "sky"))
      .toEqual({
        source: "lesson",
        nested: { version: 2 },
        [BOARD_THEME_META_KEY]: "sky",
      });
  });
});
