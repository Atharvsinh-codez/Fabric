import { describe, expect, it, vi } from "vitest";

import {
  EDUCATION_TEMPLATES,
  EDUCATION_TEMPLATE_IDS,
  buildEducationTemplate,
  insertEducationTemplate,
} from "./tldraw-education-templates";

type EducationEditor = NonNullable<Parameters<typeof insertEducationTemplate>[0]>;

const expectedShapeCounts = {
  "lesson-plan": 9,
  "kwl-chart": 6,
  "vocabulary-map": 11,
  "lab-report": 10,
  "revision-timetable": 34,
  "comparison-diagram": 9,
} as const;

type MockEditorOptions = Readonly<{
  readonly?: boolean;
  persistCreatedShapes?: boolean;
  throwOnCreate?: boolean;
  viewport?: Readonly<{ x: number; y: number; w: number; h: number }>;
}>;

function createMockEditor(options: MockEditorOptions = {}) {
  const records = new Map<string, unknown>();
  const createdBatches: unknown[][] = [];
  const editor = {} as EducationEditor;

  const createShapes = vi.fn((shapes: unknown[]) => {
    createdBatches.push(shapes);
    if (options.throwOnCreate) throw new Error("Shape capacity reached");
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
  const markHistoryStoppingPoint = vi.fn(() => "education-history-mark");
  const run = vi.fn((operation: () => void) => {
    operation();
    return editor;
  });
  const select = vi.fn(() => editor);
  const squashToMark = vi.fn(() => editor);
  const zoomToSelection = vi.fn(() => editor);

  Object.assign(editor, {
    bailToMark,
    createShapes,
    getInstanceState: () => ({ isReadonly: options.readonly ?? false }),
    getShape,
    getViewportPageBounds: () => options.viewport ?? { x: 100, y: 200, w: 1_200, h: 800 },
    markHistoryStoppingPoint,
    run,
    select,
    squashToMark,
    zoomToSelection,
  } as unknown as EducationEditor);

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

describe("tldraw education templates", () => {
  it("publishes six unique, bounded education template definitions", () => {
    expect(EDUCATION_TEMPLATES).toHaveLength(6);
    expect(EDUCATION_TEMPLATES.map((template) => template.id)).toEqual(EDUCATION_TEMPLATE_IDS);
    expect(new Set(EDUCATION_TEMPLATES.map((template) => template.name)).size).toBe(6);
    EDUCATION_TEMPLATES.forEach((template) => {
      expect(template.description.length).toBeGreaterThan(30);
      expect(template.width).toBeGreaterThanOrEqual(1_000);
      expect(template.width).toBeLessThanOrEqual(1_500);
      expect(template.height).toBeGreaterThanOrEqual(700);
      expect(template.height).toBeLessThanOrEqual(900);
    });
  });

  it.each(EDUCATION_TEMPLATE_IDS)(
    "builds the %s template deterministically from bounded native editable shapes",
    (templateId) => {
      const first = buildEducationTemplate(templateId, {
        center: { x: 1_800.5, y: -240.25 },
        instanceId: "semester 1",
      });
      const second = buildEducationTemplate(templateId, {
        center: { x: 1_800.5, y: -240.25 },
        instanceId: "semester 1",
      });

      expect(first).toEqual(second);
      expect(first.shapes).toHaveLength(expectedShapeCounts[templateId]);
      expect(first.shapes.length).toBeLessThanOrEqual(40);
      expect(new Set(first.shapeIds).size).toBe(first.shapeIds.length);
      expect(
        first.shapeIds.every((id) =>
          id.startsWith(`shape:fabric-education-${templateId}-semester-1-`),
        ),
      ).toBe(true);
      expect(first.shapes.every((shape) => ["arrow", "geo", "text"].includes(shape.type))).toBe(
        true,
      );

      first.shapes.forEach((shape) => {
        const meta = shape.meta as Record<string, unknown>;
        expect(meta).toMatchObject({
          fabricEducationTemplateId: templateId,
          fabricEducationInstanceId: "semester 1",
          fabricEducationKey: expect.any(String),
          fabricEducationLabel: expect.any(String),
          fabricEducationRole: expect.stringMatching(/^(connector|field|instruction|schedule|title)$/),
        });
        expect(String(meta.fabricEducationLabel).trim().length).toBeGreaterThan(0);
        expect(String(meta.fabricEducationLabel).length).toBeLessThanOrEqual(160);
        expect(Number.isFinite(shape.x)).toBe(true);
        expect(Number.isFinite(shape.y)).toBe(true);
        expect(shape.x).toBeGreaterThanOrEqual(first.origin.x);
        expect(shape.x).toBeLessThanOrEqual(first.origin.x + first.template.width);
        expect(shape.y).toBeGreaterThanOrEqual(first.origin.y);
        expect(shape.y).toBeLessThanOrEqual(first.origin.y + first.template.height);

        if (shape.type === "geo" || shape.type === "text") {
          const props = shape.props as Readonly<{ richText: unknown }>;
          expect(JSON.stringify(props.richText).length).toBeGreaterThan(10);
        }
      });
    },
  );

  it.each(EDUCATION_TEMPLATES)("centers $name on the requested canvas point", (template) => {
    const result = buildEducationTemplate(template.id, {
      center: { x: 900, y: 700 },
      instanceId: "viewport-test",
    });

    expect(result.origin).toEqual({
      x: Math.round(900 - template.width / 2),
      y: Math.round(700 - template.height / 2),
    });
  });

  it("changes record IDs without changing the native education layout", () => {
    const first = buildEducationTemplate("lesson-plan", {
      center: { x: 0, y: 0 },
      instanceId: "first",
    });
    const second = buildEducationTemplate("lesson-plan", {
      center: { x: 0, y: 0 },
      instanceId: "second",
    });

    expect(first.shapeIds).not.toEqual(second.shapeIds);
    expect(first.shapes.map(({ type, x, y, props }) => ({ type, x, y, props }))).toEqual(
      second.shapes.map(({ type, x, y, props }) => ({ type, x, y, props })),
    );
  });

  it("sanitizes record IDs and bounds synchronized instance provenance", () => {
    const built = buildEducationTemplate("kwl-chart", {
      center: { x: 0, y: 0 },
      instanceId: `class / 8A ${"x".repeat(200)}`,
    });

    expect(built.shapeIds.every((id) => !id.includes("/") && !id.includes(" "))).toBe(true);
    built.shapes.forEach((shape) => {
      expect(shape.meta).toMatchObject({
        fabricEducationInstanceId: `class / 8A ${"x".repeat(149)}`,
      });
      expect(String(shape.meta?.fabricEducationInstanceId)).toHaveLength(160);
    });
  });

  it("includes the requested learning structures in editable native content", () => {
    const expectedCopy = {
      "lesson-plan": ["Learning Objective", "Assessment Evidence"],
      "kwl-chart": ["What I Know", "What I Learned"],
      "vocabulary-map": ["KEY TERM", "Non-Examples"],
      "lab-report": ["Hypothesis", "Observations and Results"],
      "revision-timetable": ["Monday", "Recall task"],
      "comparison-diagram": ["Both Topics", "Synthesis"],
    } as const;

    EDUCATION_TEMPLATE_IDS.forEach((templateId) => {
      const serialized = JSON.stringify(
        buildEducationTemplate(templateId, {
          center: { x: 0, y: 0 },
          instanceId: "content-test",
        }).shapes,
      );
      expectedCopy[templateId].forEach((copy) => expect(serialized).toContain(copy));
    });
  });

  it("returns typed failures without touching history when the editor is unavailable or readonly", () => {
    expect(insertEducationTemplate(null, "lesson-plan", "missing-editor")).toEqual({
      ok: false,
      reason: "editor-unavailable",
    });

    const readonlyEditor = createMockEditor({ readonly: true });
    expect(
      insertEducationTemplate(readonlyEditor.editor, "comparison-diagram", "readonly-template"),
    ).toEqual({
      ok: false,
      reason: "readonly",
    });
    expect(readonlyEditor.mocks.markHistoryStoppingPoint).not.toHaveBeenCalled();
    expect(readonlyEditor.mocks.createShapes).not.toHaveBeenCalled();
  });

  it("inserts a centered template as one selected, collapsed undo action", () => {
    const mock = createMockEditor({
      viewport: { x: 100, y: 200, w: 1_200, h: 800 },
    });
    const expected = buildEducationTemplate("vocabulary-map", {
      center: { x: 700, y: 600 },
      instanceId: "undo-test",
    });

    const result = insertEducationTemplate(mock.editor, "vocabulary-map", "undo-test");

    expect(result).toEqual({
      ok: true,
      template: expected.template,
      shapeIds: expected.shapeIds,
    });
    expect(mock.createdBatches).toEqual([[...expected.shapes]]);
    expect(mock.mocks.markHistoryStoppingPoint).toHaveBeenCalledWith("Insert Vocabulary Map");
    expect(mock.mocks.run).toHaveBeenCalledWith(expect.any(Function), { history: "record" });
    expect(mock.mocks.select).toHaveBeenCalledWith(...expected.shapeIds);
    expect(mock.mocks.getShape).toHaveBeenCalledTimes(expected.shapeIds.length);
    expect(mock.mocks.squashToMark).toHaveBeenCalledWith("education-history-mark");
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

  it("rolls back when capacity prevents every native record from being persisted", () => {
    const mock = createMockEditor({ persistCreatedShapes: false });

    expect(insertEducationTemplate(mock.editor, "revision-timetable", "full-page")).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(mock.mocks.createShapes).toHaveBeenCalledOnce();
    expect(mock.mocks.getShape).toHaveBeenCalledOnce();
    expect(mock.mocks.bailToMark).toHaveBeenCalledWith("education-history-mark");
    expect(mock.mocks.squashToMark).not.toHaveBeenCalled();
    expect(mock.mocks.zoomToSelection).not.toHaveBeenCalled();
  });

  it("rolls back when the editor rejects the native shape batch", () => {
    const mock = createMockEditor({ throwOnCreate: true });

    expect(insertEducationTemplate(mock.editor, "lab-report", "rejected-batch")).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(mock.mocks.bailToMark).toHaveBeenCalledWith("education-history-mark");
    expect(mock.mocks.getShape).not.toHaveBeenCalled();
    expect(mock.mocks.squashToMark).not.toHaveBeenCalled();
    expect(mock.mocks.zoomToSelection).not.toHaveBeenCalled();
  });
});
