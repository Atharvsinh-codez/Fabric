// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TLDocument } from "tldraw";

vi.mock("tldraw", () => ({
  useValue: (_name: string, read: () => unknown) => read(),
}));

import { FabricBoardThemePicker } from "./board-theme-picker";

function themeEditor(initialTheme?: string) {
  let meta: TLDocument["meta"] = {
    preserved: "value",
    ...(initialTheme ? { fabricBoardTheme: initialTheme } : {}),
  };
  const updateDocumentSettings = vi.fn((settings: Pick<TLDocument, "meta">) => {
    meta = settings.meta;
  });
  return {
    editor: {
      getDocumentSettings: () => ({ meta }),
      updateDocumentSettings,
    },
    readMeta: () => meta,
    updateDocumentSettings,
  };
}

describe("Fabric board theme picker", () => {
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

  it("opens a compact six-theme chooser with Canvas selected by default", () => {
    const { editor } = themeEditor();
    act(() => root.render(<FabricBoardThemePicker editor={editor} />));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Board Theme"]',
    );
    act(() => trigger?.click());

    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(
      container.querySelector('[role="dialog"][aria-label="Choose board theme"]'),
    ).not.toBeNull();
    expect(
      container.querySelectorAll('button[aria-label^="Use "][aria-label$=" board theme"]'),
    ).toHaveLength(6);
    expect(
      container
        .querySelector('[aria-label="Use Canvas board theme"]')
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(container.textContent).toContain("Shared with everyone on this board.");
  });

  it("writes the shared theme without discarding other document metadata", () => {
    const model = themeEditor();
    act(() => root.render(<FabricBoardThemePicker editor={model.editor} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Board Theme"]')?.click());
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Use Sage board theme"]')
        ?.click(),
    );

    expect(model.updateDocumentSettings).toHaveBeenCalledOnce();
    expect(model.readMeta()).toEqual({
      preserved: "value",
      fabricBoardTheme: "sage",
    });
  });

  it("is disabled until the editor is mounted", () => {
    act(() => root.render(<FabricBoardThemePicker editor={null} />));
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="Board Theme"]',
    );
    expect(trigger?.disabled).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
