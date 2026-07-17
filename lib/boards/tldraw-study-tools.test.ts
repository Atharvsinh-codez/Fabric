import { describe, expect, it, vi } from "vitest";

import { calculateStudyExpression } from "./study-calculator";
import {
  buildStudyKit,
  insertCalculationCard,
  insertStudyKit,
  STUDY_KITS,
  STUDY_KIT_IDS,
} from "./tldraw-study-tools";

type StudyEditor = NonNullable<Parameters<typeof insertStudyKit>[0]>;

const expectedShapeCounts = {
  "cornell-notes": 5,
  "concept-map": 11,
  "study-planner": 6,
  "recall-cards": 8,
} as const;

type MockEditorOptions = Readonly<{
  readonly?: boolean;
  persistCreatedShapes?: boolean;
  viewport?: Readonly<{ x: number; y: number; w: number; h: number }>;
}>;

function createMockEditor(options: MockEditorOptions = {}) {
  const records = new Map<string, unknown>();
  const createdBatches: unknown[][] = [];
  const editor = {} as StudyEditor;

  const createShapes = vi.fn((shapes: unknown[]) => {
    createdBatches.push(shapes);
    if (options.persistCreatedShapes !== false) {
      shapes.forEach((shape) => {
        if (
          typeof shape === "object" &&
          shape !== null &&
          "id" in shape &&
          typeof shape.id === "string"
        ) {
          records.set(shape.id, shape);
        }
      });
    }
    return editor;
  });
  const bailToMark = vi.fn(() => editor);
  const getShape = vi.fn((id: unknown) => records.get(String(id)));
  const markHistoryStoppingPoint = vi.fn(() => "study-history-mark");
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
  } as unknown as StudyEditor);

  return {
    editor,
    records,
    createdBatches,
    mocks: {
      bailToMark,
      createShapes,
      getShape,
      markHistoryStoppingPoint,
      run,
      select,
      squashToMark,
      zoomToSelection,
    },
  };
}

describe("tldraw study tools", () => {
  it.each(STUDY_KIT_IDS)(
    "builds the %s kit deterministically from native editable shapes",
    (kitId) => {
      const first = buildStudyKit(kitId, {
        center: { x: 1_800.5, y: -240.25 },
        instanceId: "semester 1",
      });
      const second = buildStudyKit(kitId, {
        center: { x: 1_800.5, y: -240.25 },
        instanceId: "semester 1",
      });

      expect(first).toEqual(second);
      expect(first.shapes).toHaveLength(expectedShapeCounts[kitId]);
      expect(new Set(first.shapeIds).size).toBe(first.shapeIds.length);
      expect(first.shapeIds.every((id) => id.startsWith(`shape:fabric-study-${kitId}-semester-1-`)))
        .toBe(true);
      expect(first.shapes.every((shape) => ["arrow", "geo", "text"].includes(shape.type)))
        .toBe(true);
      first.shapes.forEach((shape) => {
        expect(shape.meta).toMatchObject({
          fabricStudyTool: kitId,
          fabricStudyInstanceId: "semester 1",
        });
      });
    },
  );

  it.each(STUDY_KITS)("centers $name on the requested canvas point", (kit) => {
    const result = buildStudyKit(kit.id, {
      center: { x: 900, y: 700 },
      instanceId: "viewport-test",
    });

    expect(result.origin).toEqual({
      x: Math.round(900 - kit.width / 2),
      y: Math.round(700 - kit.height / 2),
    });
  });

  it("changes record IDs without changing native study layout", () => {
    const first = buildStudyKit("recall-cards", {
      center: { x: 0, y: 0 },
      instanceId: "first",
    });
    const second = buildStudyKit("recall-cards", {
      center: { x: 0, y: 0 },
      instanceId: "second",
    });

    expect(first.shapeIds).not.toEqual(second.shapeIds);
    expect(first.shapes.map(({ type, x, y, props }) => ({ type, x, y, props }))).toEqual(
      second.shapes.map(({ type, x, y, props }) => ({ type, x, y, props })),
    );
  });

  it("returns typed failures without touching history when the editor is unavailable or readonly", () => {
    const calculation = calculateStudyExpression("2 + 2");
    if (!calculation.ok) throw new Error(calculation.message);

    expect(insertStudyKit(null, "cornell-notes", "missing-editor")).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });
    expect(insertCalculationCard(null, calculation, "missing-editor")).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });

    const readonlyEditor = createMockEditor({ readonly: true });
    expect(insertStudyKit(readonlyEditor.editor, "concept-map", "readonly-kit")).toEqual({
      ok: false,
      reason: "readonly",
    });
    expect(insertCalculationCard(readonlyEditor.editor, calculation, "readonly-card")).toEqual({
      ok: false,
      reason: "readonly",
    });
    expect(readonlyEditor.mocks.markHistoryStoppingPoint).not.toHaveBeenCalled();
    expect(readonlyEditor.mocks.createShapes).not.toHaveBeenCalled();
  });

  it("inserts a centered kit as one selected, collapsed undo action", () => {
    const mock = createMockEditor({
      viewport: { x: 100, y: 200, w: 1_200, h: 800 },
    });
    const expected = buildStudyKit("cornell-notes", {
      center: { x: 700, y: 600 },
      instanceId: "undo-test",
    });

    const result = insertStudyKit(mock.editor, "cornell-notes", "undo-test");

    expect(result).toEqual({
      ok: true,
      name: "Cornell Notes",
      shapeIds: expected.shapeIds,
    });
    expect(mock.createdBatches).toEqual([[...expected.shapes]]);
    expect(mock.mocks.markHistoryStoppingPoint).toHaveBeenCalledWith("Insert Cornell Notes");
    expect(mock.mocks.run).toHaveBeenCalledWith(expect.any(Function), { history: "record" });
    expect(mock.mocks.select).toHaveBeenCalledWith(...expected.shapeIds);
    expect(mock.mocks.getShape).toHaveBeenCalledTimes(expected.shapeIds.length);
    expect(mock.mocks.squashToMark).toHaveBeenCalledWith("study-history-mark");
    expect(mock.mocks.zoomToSelection).toHaveBeenCalledWith({
      animation: { duration: 220 },
    });
    expect(mock.mocks.bailToMark).not.toHaveBeenCalled();

    expect(mock.mocks.markHistoryStoppingPoint.mock.invocationCallOrder[0]).toBeLessThan(
      mock.mocks.run.mock.invocationCallOrder[0]!,
    );
    expect(mock.mocks.run.mock.invocationCallOrder[0]).toBeLessThan(
      mock.mocks.squashToMark.mock.invocationCallOrder[0]!,
    );
    expect(mock.mocks.squashToMark.mock.invocationCallOrder[0]).toBeLessThan(
      mock.mocks.zoomToSelection.mock.invocationCallOrder[0]!,
    );
  });

  it("bails to the history mark when capacity prevents native records from being created", () => {
    const mock = createMockEditor({ persistCreatedShapes: false });

    expect(insertStudyKit(mock.editor, "study-planner", "full-page")).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(mock.mocks.createShapes).toHaveBeenCalledOnce();
    expect(mock.mocks.getShape).toHaveBeenCalledOnce();
    expect(mock.mocks.bailToMark).toHaveBeenCalledWith("study-history-mark");
    expect(mock.mocks.squashToMark).not.toHaveBeenCalled();
    expect(mock.mocks.zoomToSelection).not.toHaveBeenCalled();
    expect(mock.mocks.getShape.mock.invocationCallOrder[0]).toBeLessThan(
      mock.mocks.bailToMark.mock.invocationCallOrder[0]!,
    );
  });

  it("inserts a centered native calculation card with bounded provenance and readable text", () => {
    const calculation = calculateStudyExpression("12 \u00d7 3");
    if (!calculation.ok) throw new Error(calculation.message);
    const mock = createMockEditor({
      viewport: { x: 100, y: 200, w: 800, h: 600 },
    });

    const result = insertCalculationCard(mock.editor, calculation, "calc/lesson 1");

    expect(result).toMatchObject({ ok: true, name: "Calculation" });
    expect(mock.createdBatches).toHaveLength(1);
    expect(mock.createdBatches[0]).toHaveLength(1);
    const card = mock.createdBatches[0]?.[0] as {
      id: string;
      type: string;
      x: number;
      y: number;
      meta: Record<string, unknown>;
      props: Record<string, unknown>;
    };
    expect(card).toMatchObject({
      id: expect.stringMatching(/^shape:fabric-study-calculator-calc-lesson-1-result$/),
      type: "geo",
      x: 292,
      y: 395,
      meta: {
        fabricStudyTool: "calculator",
        fabricStudyInstanceId: "calc/lesson 1",
        fabricStudyKey: "result",
      },
      props: {
        w: 416,
        h: 210,
        geo: "rectangle",
        color: "light-blue",
        fill: "solid",
        font: "sans",
        size: "l",
        verticalAlign: "middle",
      },
    });
    const serializedText = JSON.stringify(card.props.richText);
    expect(serializedText).toContain("Calculation");
    expect(serializedText).toContain("12 \u00d7 3");
    expect(serializedText).toContain("36");
    expect(mock.mocks.markHistoryStoppingPoint).toHaveBeenCalledWith("Insert Calculation");
    expect(mock.mocks.squashToMark).toHaveBeenCalledWith("study-history-mark");
    expect(mock.mocks.zoomToSelection).not.toHaveBeenCalled();
    expect(mock.mocks.bailToMark).not.toHaveBeenCalled();
  });

  it("revalidates forged calculation input before writing to the editor", () => {
    const mock = createMockEditor();
    const forged = {
      ok: true as const,
      expression: "9".repeat(10_000),
      value: 9,
      display: "9",
    };

    expect(insertCalculationCard(mock.editor, forged, "forged")).toEqual({
      ok: false,
      reason: "invalid-calculation",
    });
    expect(mock.mocks.markHistoryStoppingPoint).not.toHaveBeenCalled();
    expect(mock.mocks.createShapes).not.toHaveBeenCalled();
  });
});
