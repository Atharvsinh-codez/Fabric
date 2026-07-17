// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertionMocks = vi.hoisted(() => ({
  insertCalculationCard: vi.fn(),
  insertEducationTemplate: vi.fn(),
  insertFabricTemplate: vi.fn(),
  insertStudyKit: vi.fn(),
}));

vi.mock("@/lib/boards/tldraw-study-tools", () => ({
  STUDY_KITS: [
    {
      id: "cornell-notes",
      name: "Cornell Notes",
      description: "Capture notes, cues, and a concise summary.",
      width: 1_180,
      height: 820,
    },
  ],
  insertCalculationCard: insertionMocks.insertCalculationCard,
  insertStudyKit: insertionMocks.insertStudyKit,
}));

vi.mock("@/lib/boards/tldraw-templates", () => ({
  FABRIC_TEMPLATES: [
    {
      id: "brainstorm",
      name: "Brainstorm Map",
      description: "Develop one challenge into useful next steps.",
      width: 1_120,
      height: 700,
    },
  ],
  insertFabricTemplate: insertionMocks.insertFabricTemplate,
}));

vi.mock("@/lib/boards/tldraw-education-templates", () => ({
  EDUCATION_TEMPLATES: [
    {
      id: "lesson-plan",
      name: "Lesson Plan",
      description: "Plan an objective, learning sequence, assessment, and next steps.",
      width: 1_240,
      height: 820,
    },
  ],
  insertEducationTemplate: insertionMocks.insertEducationTemplate,
}));

import { FabricBoardToolsPanel } from "./board-tools-panel";

const editor = {} as Editor;

describe("Fabric board tools panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    insertionMocks.insertStudyKit.mockReset().mockReturnValue({
      ok: true,
      name: "Cornell Notes",
      shapeIds: ["shape:cornell-notes"],
    });
    insertionMocks.insertFabricTemplate.mockReset().mockReturnValue({
      ok: true,
      template: {
        id: "brainstorm",
        name: "Brainstorm Map",
        description: "Develop one challenge into useful next steps.",
        width: 1_120,
        height: 700,
      },
      shapeIds: ["shape:brainstorm"],
    });
    insertionMocks.insertEducationTemplate.mockReset().mockReturnValue({
      ok: true,
      template: {
        id: "lesson-plan",
        name: "Lesson Plan",
        description: "Plan an objective, learning sequence, assessment, and next steps.",
        width: 1_240,
        height: 820,
      },
      shapeIds: ["shape:lesson-plan"],
    });
    insertionMocks.insertCalculationCard.mockReset().mockReturnValue({
      ok: true,
      name: "Calculation",
      shapeIds: ["shape:calculation"],
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function renderPanel({
    open = true,
    canEdit = true,
    panelEditor = editor,
    onOpen = vi.fn(),
    onClose = vi.fn(),
  }: {
    open?: boolean;
    canEdit?: boolean;
    panelEditor?: Editor | null;
    onOpen?: () => void;
    onClose?: () => void;
  } = {}) {
    act(() => {
      root.render(
        <FabricBoardToolsPanel
          editor={panelEditor}
          boardId="board:test"
          open={open}
          canEdit={canEdit}
          onOpen={onOpen}
          onClose={onClose}
        />,
      );
    });
  }

  function click(element: Element | null | undefined) {
    expect(element).toBeTruthy();
    act(() => {
      element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function buttonWithText(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(button).toBeDefined();
    return button!;
  }

  function tabWithText(label: string): HTMLButtonElement {
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((candidate) => candidate.textContent?.trim() === label);
    expect(tab).toBeDefined();
    return tab!;
  }

  function writeExpression(value: string) {
    const input = container.querySelector<HTMLInputElement>(
      "#fabric-stem-calculation",
    );
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("connects every accessible tab to its single labelled panel", () => {
    renderPanel();

    const panel = container.querySelector<HTMLElement>(
      '[aria-label="Board Tools"]',
    );
    const tablist = container.querySelector<HTMLElement>(
      '[role="tablist"][aria-label="Board Tool Categories"]',
    );
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const studyTab = tabWithText("Study");
    const studyPanel = container.querySelector<HTMLElement>(
      "#fabric-board-tools-study-panel",
    );

    expect(panel?.id).toBe("fabric-board-tools-panel");
    expect(tablist).toBeTruthy();
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Study",
      "STEM",
      "Navigate",
      "Focus",
      "Templates",
    ]);
    expect(studyTab.getAttribute("aria-selected")).toBe("true");
    expect(studyTab.getAttribute("aria-controls")).toBe(studyPanel?.id);
    expect(studyPanel?.getAttribute("role")).toBe("tabpanel");
    expect(studyPanel?.getAttribute("aria-labelledby")).toBe(studyTab.id);

    const stemTab = tabWithText("STEM");
    click(stemTab);
    const stemPanel = container.querySelector<HTMLElement>(
      "#fabric-board-tools-stem-panel",
    );
    expect(stemTab.getAttribute("aria-selected")).toBe("true");
    expect(stemTab.getAttribute("aria-controls")).toBe(
      stemPanel?.id,
    );
    expect(stemPanel?.getAttribute("aria-labelledby")).toBe(
      stemTab.id,
    );
    expect(container.querySelector("#fabric-board-tools-study-panel")).toBeNull();
  });

  it("adds a study kit plus education and planning templates through native insertion adapters", () => {
    renderPanel();

    click(buttonWithText("Add Layout"));
    expect(insertionMocks.insertStudyKit).toHaveBeenCalledWith(
      editor,
      "cornell-notes",
    );
    expect(container.textContent).toContain("Cornell Notes added to the board.");

    click(tabWithText("Templates"));
    click(buttonWithText("Add Template"));
    expect(insertionMocks.insertEducationTemplate).toHaveBeenCalledWith(
      editor,
      "lesson-plan",
    );
    expect(container.textContent).toContain("Lesson Plan added to the board.");

    click(buttonWithText("Planning"));
    click(buttonWithText("Add Template"));
    expect(insertionMocks.insertFabricTemplate).toHaveBeenCalledWith(
      editor,
      "brainstorm",
    );
    expect(container.textContent).toContain("Brainstorm Map added to the board.");
  });

  it("handles typed and keypad calculations, errors, Enter, and Add to Board", () => {
    renderPanel();
    click(tabWithText("STEM"));

    const input = container.querySelector<HTMLInputElement>(
      "#fabric-stem-calculation",
    );
    const label = container.querySelector<HTMLLabelElement>(
      'label[for="fabric-stem-calculation"]',
    );
    const addToBoard = buttonWithText("Add Result");
    expect(label?.textContent).toBe("Expression");
    expect(input?.getAttribute("name")).toBe("stem-calculation");

    writeExpression("1/0");
    expect(container.textContent).toContain("Cannot divide by zero.");
    expect(addToBoard.disabled).toBe(true);
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
      }));
    });
    expect(insertionMocks.insertCalculationCard).not.toHaveBeenCalled();

    writeExpression("2+2");
    expect(addToBoard.disabled).toBe(false);
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "Enter",
      }));
    });
    expect(insertionMocks.insertCalculationCard).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({
        ok: true,
        expression: "2+2",
        display: "4",
      }),
    );

    click(buttonWithText("Clear Expression"));
    click(container.querySelector('[aria-label="Seven"]'));
    click(container.querySelector('[aria-label="Multiply"]'));
    click(container.querySelector('[aria-label="Eight"]'));
    expect(input?.value).toBe(`7\u00d78`);
    expect(container.textContent).toContain("= 56");

    click(addToBoard);
    expect(insertionMocks.insertCalculationCard).toHaveBeenCalledTimes(2);
    expect(insertionMocks.insertCalculationCard).toHaveBeenLastCalledWith(
      editor,
      expect.objectContaining({
        ok: true,
        expression: `7\u00d78`,
        display: "56",
      }),
    );
    expect(container.textContent).toContain("Calculation added to the board.");
  });

  it("hides every board tool when the current board is read-only", () => {
    renderPanel({ canEdit: false });

    expect(container.querySelector('[aria-label="Board Tools"]')).toBeNull();
    expect(container.querySelector('[aria-label="Personal Focus Timer"]')).toBeNull();
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(insertionMocks.insertStudyKit).not.toHaveBeenCalled();
    expect(insertionMocks.insertFabricTemplate).not.toHaveBeenCalled();
    expect(insertionMocks.insertCalculationCard).not.toHaveBeenCalled();
  });

  it("starts, pauses, minimizes, resumes, and resets the personal focus timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    const onOpen = vi.fn();
    const onClose = vi.fn();

    renderPanel({ onOpen, onClose });
    click(tabWithText("Focus"));
    expect(container.textContent).toContain("25:00");

    click(buttonWithText("Start Timer"));
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain("24:59");

    click(buttonWithText("Pause Timer"));
    act(() => vi.advanceTimersByTime(3_000));
    expect(container.textContent).toContain("24:59");

    click(buttonWithText("Start Timer"));
    click(container.querySelector('[aria-label="Close Board Tools"]'));
    expect(onClose).toHaveBeenCalledOnce();
    renderPanel({ open: false, onOpen, onClose });

    const minimizedTimer = container.querySelector<HTMLElement>(
      '[aria-label="Personal Focus Timer"]',
    );
    expect(minimizedTimer?.textContent).toContain("My Focus");
    expect(minimizedTimer?.textContent).toContain("24:59");
    expect(
      minimizedTimer?.querySelector('[aria-label="Pause Focus Timer"]'),
    ).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    expect(minimizedTimer?.textContent).toContain("24:58");
    click(minimizedTimer?.querySelector('[aria-label="Pause Focus Timer"]'));
    expect(
      minimizedTimer?.querySelector('[aria-label="Resume Focus Timer"]'),
    ).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_000));
    expect(minimizedTimer?.textContent).toContain("24:58");

    click(minimizedTimer?.querySelector("button:not([aria-label])"));
    expect(onOpen).toHaveBeenCalledOnce();
    renderPanel({ onOpen, onClose });
    click(buttonWithText("Reset Timer"));
    expect(container.textContent).toContain("25:00");
    act(() => vi.advanceTimersByTime(2_000));
    expect(container.textContent).toContain("25:00");
  });
});
