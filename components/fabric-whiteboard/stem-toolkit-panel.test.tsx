// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Editor } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const insertionMocks = vi.hoisted(() => ({
  insertCalculationCard: vi.fn(),
  insertStemConversionCard: vi.fn(),
  insertStemEquationCard: vi.fn(),
  insertStemGraph: vi.fn(),
  insertStemInstrument: vi.fn(),
}));

vi.mock("@/lib/boards/tldraw-study-tools", () => ({
  insertCalculationCard: insertionMocks.insertCalculationCard,
}));

vi.mock("@/lib/boards/tldraw-stem-tools", () => ({
  STEM_INSTRUMENTS: [
    {
      id: "ruler",
      name: "Ruler",
      description: "Add an editable centimetre ruler.",
      width: 920,
      height: 230,
    },
    {
      id: "protractor",
      name: "Protractor",
      description: "Add a 180-degree guide.",
      width: 920,
      height: 560,
    },
    {
      id: "coordinate-plane",
      name: "Coordinate Plane",
      description: "Add a labelled coordinate grid.",
      width: 820,
      height: 780,
    },
  ],
  insertStemConversionCard: insertionMocks.insertStemConversionCard,
  insertStemEquationCard: insertionMocks.insertStemEquationCard,
  insertStemGraph: insertionMocks.insertStemGraph,
  insertStemInstrument: insertionMocks.insertStemInstrument,
}));

import { FabricStemToolkitPanel } from "./stem-toolkit-panel";

const editor = {} as Editor;
const onAnnouncement = vi.fn<(message: string) => void>();

describe("Fabric STEM toolkit panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onAnnouncement.mockReset();

    for (const mock of Object.values(insertionMocks)) {
      mock.mockReset().mockReturnValue({
        ok: true,
        name: "STEM Tool",
        shapeIds: ["shape:stem-tool"],
      });
    }

    act(() => {
      root.render(
        <FabricStemToolkitPanel editor={editor} onAnnouncement={onAnnouncement} />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

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

  function writeInput(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    expect(input).toBeTruthy();
    const prototype = input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    act(() => {
      valueSetter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("connects five compact modes to one labelled active panel", () => {
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      "Calculator",
      "Graph",
      "Convert",
      "Equation",
      "Tools",
    ]);
    expect(tabWithText("Calculator").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#fabric-stem-calculator-panel")).toBeTruthy();

    click(tabWithText("Graph"));
    expect(tabWithText("Graph").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#fabric-stem-graph-panel")?.getAttribute("role"))
      .toBe("tabpanel");
    expect(container.querySelector('svg[aria-label="Preview of y equals sin(x)"]')).toBeTruthy();
  });

  it("keeps calculations safe and inserts valid results only", () => {
    writeInput("#fabric-stem-calculation", "1/0");
    expect(container.textContent).toContain("Cannot divide by zero.");
    expect(buttonWithText("Add Result").disabled).toBe(true);

    writeInput("#fabric-stem-calculation", "6*7");
    expect(container.textContent).toContain("= 42");
    click(buttonWithText("Add Result"));
    expect(insertionMocks.insertCalculationCard).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ ok: true, display: "42" }),
    );
    expect(onAnnouncement).toHaveBeenCalledWith("STEM Tool added to the board.");
  });

  it("inserts live graphs, conversions, equation cards, and instruments", () => {
    click(tabWithText("Graph"));
    click(buttonWithText("Add Graph"));
    expect(insertionMocks.insertStemGraph).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ expression: "sin(x)", sampleCount: 121 }),
    );

    click(tabWithText("Convert"));
    expect(container.textContent).toContain("0.001 km");
    click(buttonWithText("Add Conversion"));
    expect(insertionMocks.insertStemConversionCard).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ category: "length", from: "m", to: "km", value: 1 }),
    );

    click(tabWithText("Equation"));
    expect(buttonWithText("Add Equation").disabled).toBe(true);
    writeInput("#fabric-stem-equation", "E = mc^2");
    click(buttonWithText("Add Equation"));
    expect(insertionMocks.insertStemEquationCard).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ title: "Equation", equation: "E = mc^2" }),
    );

    click(tabWithText("Tools"));
    click(buttonWithText("Add Tool"));
    expect(insertionMocks.insertStemInstrument).toHaveBeenCalledWith(editor, "ruler");
  });
});
