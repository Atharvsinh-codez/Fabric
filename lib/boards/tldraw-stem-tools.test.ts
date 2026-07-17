import { describe, expect, it, vi } from "vitest";

import { convertStemUnit, sampleStemGraph, validateStemEquationCard } from "./stem-math";
import {
  buildStemConversionCard,
  buildStemEquationCard,
  buildStemGraph,
  buildStemInstrument,
  insertStemConversionCard,
  insertStemEquationCard,
  insertStemGraph,
  insertStemInstrument,
  STEM_INSTRUMENTS,
  STEM_INSTRUMENT_IDS,
} from "./tldraw-stem-tools";

type StemEditor = NonNullable<Parameters<typeof insertStemInstrument>[0]>;

type MockEditorOptions = Readonly<{
  readonly?: boolean;
  persistCreatedShapes?: boolean;
  viewport?: Readonly<{ x: number; y: number; w: number; h: number }>;
}>;

function createMockEditor(options: MockEditorOptions = {}) {
  const records = new Map<string, unknown>();
  const createdBatches: unknown[][] = [];
  const editor = {} as StemEditor;
  const createShapes = vi.fn((shapes: unknown[]) => {
    createdBatches.push(shapes);
    if (options.persistCreatedShapes !== false) {
      shapes.forEach((shape) => {
        if (typeof shape === "object" && shape !== null && "id" in shape && typeof shape.id === "string") {
          records.set(shape.id, shape);
        }
      });
    }
    return editor;
  });
  const bailToMark = vi.fn(() => editor);
  const getShape = vi.fn((id: unknown) => records.get(String(id)));
  const markHistoryStoppingPoint = vi.fn(() => "stem-history-mark");
  const run = vi.fn((operation: () => void) => {
    operation();
    return editor;
  });
  const select = vi.fn(() => editor);
  const squashToMark = vi.fn(() => editor);
  const zoomToSelection = vi.fn(() => editor);
  Object.assign(editor, {
    createShapes,
    bailToMark,
    getInstanceState: () => ({ isReadonly: options.readonly ?? false }),
    getShape,
    getViewportPageBounds: () => options.viewport ?? { x: 100, y: 200, w: 1_200, h: 800 },
    markHistoryStoppingPoint,
    run,
    select,
    squashToMark,
    zoomToSelection,
  } as unknown as StemEditor);
  return {
    editor,
    records,
    createdBatches,
    mocks: { bailToMark, createShapes, getShape, markHistoryStoppingPoint, run, select, squashToMark, zoomToSelection },
  };
}

describe("native STEM builders", () => {
  it("builds deterministic graph records from bounded native shapes", () => {
    const graph = sampleStemGraph({ expression: "sin(x)", xMin: -6, xMax: 6 });
    if (!graph.ok) throw new Error(graph.message);
    const first = buildStemGraph(graph, { center: { x: 500, y: 600 }, instanceId: "lesson 1" });
    const second = buildStemGraph(graph, { center: { x: 500, y: 600 }, instanceId: "lesson 1" });

    expect(first).toEqual(second);
    expect(first.origin).toEqual({ x: 30, y: 250 });
    expect(first.shapeIds.every((id) => id.startsWith("shape:fabric-stem-graph-lesson-1-"))).toBe(true);
    expect(first.shapes.every(({ type }) => ["draw", "geo", "text"].includes(type))).toBe(true);
    const curve = first.shapes.find((shape) => shape.id.endsWith("-curve"));
    expect(curve).toMatchObject({ type: "draw", meta: { fabricStemTool: "graph" } });
    expect(JSON.stringify(curve)).toContain("segments");
  });

  it.each(STEM_INSTRUMENT_IDS)("builds the %s as editable synchronized records", (id) => {
    const instrument = STEM_INSTRUMENTS.find((candidate) => candidate.id === id);
    if (!instrument) throw new Error(`Missing ${id}`);
    const built = buildStemInstrument(id, { center: { x: 1_000, y: 800 }, instanceId: "geometry" });
    expect(built.name).toBe(instrument.name);
    expect(built.origin).toEqual({
      x: Math.round(1_000 - instrument.width / 2),
      y: Math.round(800 - instrument.height / 2),
    });
    expect(built.shapeIds.length).toBeGreaterThan(3);
    expect(new Set(built.shapeIds).size).toBe(built.shapeIds.length);
    built.shapes.forEach((shape) => {
      expect(shape.meta).toMatchObject({ fabricStemTool: id, fabricStemInstanceId: "geometry" });
    });
  });

  it("bounds synchronized provenance even when a caller supplies an oversized instance ID", () => {
    const built = buildStemInstrument("ruler", {
      center: { x: 0, y: 0 },
      instanceId: `geometry / ${"x".repeat(240)}`,
    });
    built.shapes.forEach((shape) => {
      expect(String(shape.meta?.fabricStemInstanceId)).toHaveLength(160);
    });
  });

  it("builds readable equation and conversion cards", () => {
    const equation = validateStemEquationCard({
      title: "Ohm’s Law",
      equation: "V = IR",
      note: "Voltage equals current multiplied by resistance.",
    });
    const conversion = convertStemUnit({ category: "length", value: 5, from: "km", to: "mi" });
    if (!equation.ok) throw new Error(equation.message);
    if (!conversion.ok) throw new Error(conversion.message);
    const equationCard = buildStemEquationCard(equation.card, {
      center: { x: 0, y: 0 },
      instanceId: "equation",
    });
    const conversionCard = buildStemConversionCard(conversion, {
      center: { x: 0, y: 0 },
      instanceId: "conversion",
    });
    expect(JSON.stringify(equationCard.shapes)).toContain("Ohm’s Law");
    expect(JSON.stringify(equationCard.shapes)).toContain("V = IR");
    expect(JSON.stringify(conversionCard.shapes)).toContain("Unit Conversion");
    expect(JSON.stringify(conversionCard.shapes)).toContain("mi");
  });
});

describe("native STEM insertion", () => {
  it("returns typed failures without touching editor history", () => {
    expect(insertStemInstrument(null, "ruler", "missing")).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });
    expect(insertStemGraph(null, { expression: "x" }, "missing")).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });
    const readonly = createMockEditor({ readonly: true });
    expect(insertStemEquationCard(readonly.editor, { equation: "a² + b² = c²" }, "readonly"))
      .toEqual({ ok: false, reason: "readonly" });
    expect(readonly.mocks.markHistoryStoppingPoint).not.toHaveBeenCalled();
    expect(readonly.mocks.createShapes).not.toHaveBeenCalled();
  });

  it("inserts a graph as one selected and collapsed undo action", () => {
    const mock = createMockEditor({ viewport: { x: 100, y: 200, w: 1_000, h: 700 } });
    const result = insertStemGraph(
      mock.editor,
      { expression: "x^2", xMin: -5, xMax: 5, yMin: -2, yMax: 20 },
      "graph-undo",
    );
    expect(result).toMatchObject({ ok: true, name: "Function Graph" });
    expect(mock.createdBatches).toHaveLength(1);
    expect(mock.mocks.markHistoryStoppingPoint).toHaveBeenCalledWith("Insert Function Graph");
    expect(mock.mocks.run).toHaveBeenCalledWith(expect.any(Function), { history: "record" });
    expect(mock.mocks.select).toHaveBeenCalled();
    expect(mock.mocks.squashToMark).toHaveBeenCalledWith("stem-history-mark");
    expect(mock.mocks.zoomToSelection).toHaveBeenCalledWith({ animation: { duration: 220 } });
    expect(mock.mocks.bailToMark).not.toHaveBeenCalled();
  });

  it("adds cards without forcing the camera and validates before writing", () => {
    const mock = createMockEditor();
    expect(
      insertStemEquationCard(mock.editor, { title: "", equation: "" }, "invalid-equation"),
    ).toMatchObject({ ok: false, reason: "invalid-input" });
    expect(mock.mocks.markHistoryStoppingPoint).not.toHaveBeenCalled();

    const result = insertStemConversionCard(
      mock.editor,
      { category: "temperature", value: 212, from: "f", to: "c" },
      "boiling-point",
    );
    expect(result).toMatchObject({ ok: true, name: "Unit Conversion" });
    expect(mock.mocks.zoomToSelection).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.createdBatches[0])).toContain("212");
    expect(JSON.stringify(mock.createdBatches[0])).toContain("100");
  });

  it("bails to the history mark when capacity prevents record creation", () => {
    const mock = createMockEditor({ persistCreatedShapes: false });
    expect(insertStemInstrument(mock.editor, "coordinate-plane", "full-page")).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(mock.mocks.createShapes).toHaveBeenCalledOnce();
    expect(mock.mocks.getShape).toHaveBeenCalledOnce();
    expect(mock.mocks.bailToMark).toHaveBeenCalledWith("stem-history-mark");
    expect(mock.mocks.squashToMark).not.toHaveBeenCalled();
    expect(mock.mocks.zoomToSelection).not.toHaveBeenCalled();
  });
});
