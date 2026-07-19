// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NEW_BOARD_THEME } from "@/lib/boards/board-theme";

import { BoardThemeSelector } from "./board-theme-selector";

describe("BoardThemeSelector", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("shows all themes with Grid selected for a new board", () => {
    act(() =>
      root.render(
        <BoardThemeSelector
          value={DEFAULT_NEW_BOARD_THEME}
          onChange={vi.fn()}
          name="test-board-theme"
        />,
      ),
    );

    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(6);
    expect(
      container.querySelector<HTMLInputElement>('input[value="grid"]')?.checked,
    ).toBe(true);
    expect(
      container.querySelector('[data-board-theme-option="grid"]')?.getAttribute(
        "data-selected",
      ),
    ).toBe("true");
    expect(container.querySelector('[data-board-theme-option="grid"] svg')).not.toBeNull();
  });

  it("reports the selected theme through the native radio group", () => {
    const onChange = vi.fn();
    act(() =>
      root.render(
        <BoardThemeSelector
          value="grid"
          onChange={onChange}
          name="test-board-theme"
        />,
      ),
    );

    act(() =>
      container.querySelector<HTMLInputElement>('input[value="sand"]')?.click(),
    );

    expect(onChange).toHaveBeenCalledWith("sand");
  });
});
