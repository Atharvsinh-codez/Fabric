import { describe, expect, it, vi } from "vitest";

import {
  FABRIC_TEMPLATES,
  FABRIC_TEMPLATE_IDS,
  buildFabricTemplate,
  insertFabricTemplate,
} from "./tldraw-templates";

const expectedShapeCounts = {
  brainstorm: 11,
  "customer-journey": 25,
  kanban: 19,
  swot: 22,
} as const;

describe("Fabric tldraw templates", () => {
  it.each(FABRIC_TEMPLATE_IDS)(
    "builds the %s template deterministically with unique native shape IDs",
    (templateId) => {
      const first = buildFabricTemplate(templateId, {
        center: { x: 2_000.5, y: -320.25 },
        instanceId: "instance-1",
      });
      const second = buildFabricTemplate(templateId, {
        center: { x: 2_000.5, y: -320.25 },
        instanceId: "instance-1",
      });
      const ids = new Set(first.shapeIds);

      expect(first).toEqual(second);
      expect(first.shapes).toHaveLength(expectedShapeCounts[templateId]);
      expect(ids.size).toBe(first.shapes.length);
      expect(first.shapeIds.every((id) => id.startsWith(`shape:fabric-${templateId}-instance-1-`))).toBe(
        true,
      );
      const shapeTypes = new Set(first.shapes.map((shape) => shape.type));
      expect(shapeTypes.has("geo")).toBe(true);
      expect(shapeTypes.has("text")).toBe(true);
      expect(first.shapes.every((shape) => ["arrow", "geo", "text"].includes(shape.type))).toBe(
        true,
      );
    },
  );

  it.each(FABRIC_TEMPLATES)("centers $name in the requested viewport", (template) => {
    const result = buildFabricTemplate(template.id, {
      center: { x: 900, y: 700 },
      instanceId: "viewport-test",
    });

    expect(result.origin).toEqual({
      x: Math.round(900 - template.width / 2),
      y: Math.round(700 - template.height / 2),
    });
  });

  it("changes record IDs without changing layout when a new instance is inserted", () => {
    const first = buildFabricTemplate("swot", {
      center: { x: 0, y: 0 },
      instanceId: "first",
    });
    const second = buildFabricTemplate("swot", {
      center: { x: 0, y: 0 },
      instanceId: "second",
    });

    expect(first.shapeIds).not.toEqual(second.shapeIds);
    expect(first.shapes.map(({ type, x, y, props }) => ({ type, x, y, props }))).toEqual(
      second.shapes.map(({ type, x, y, props }) => ({ type, x, y, props })),
    );
  });

  it("refuses to insert templates into a readonly editor", () => {
    const createShapes = vi.fn();
    const run = vi.fn();
    const editor = {
      createShapes,
      getInstanceState: () => ({ isReadonly: true }),
      getViewportPageBounds: vi.fn(),
      markHistoryStoppingPoint: vi.fn(),
      run,
      select: vi.fn(),
      squashToMark: vi.fn(),
      zoomToSelection: vi.fn(),
    } as unknown as Parameters<typeof insertFabricTemplate>[0];

    expect(insertFabricTemplate(editor, "kanban", "readonly-test")).toEqual({
      ok: false,
      reason: "readonly",
    });
    expect(run).not.toHaveBeenCalled();
    expect(createShapes).not.toHaveBeenCalled();
  });

  it("inserts, selects, and frames a template as one collapsed history action", () => {
    const createdShapes: unknown[][] = [];
    const createShapes = vi.fn((shapes: unknown[]) => {
      createdShapes.push(shapes);
      return editor;
    });
    const markHistoryStoppingPoint = vi.fn(() => "history-mark");
    const select = vi.fn(() => editor);
    const squashToMark = vi.fn(() => editor);
    const zoomToSelection = vi.fn(() => editor);
    const run = vi.fn((operation: () => void, options?: unknown) => {
      void options;
      operation();
      return editor;
    });
    const editor = {
      createShapes,
      getInstanceState: () => ({ isReadonly: false }),
      getViewportPageBounds: () => ({ x: 100, y: 200, w: 1_200, h: 800 }),
      markHistoryStoppingPoint,
      run,
      select,
      squashToMark,
      zoomToSelection,
    } as unknown as Parameters<typeof insertFabricTemplate>[0];

    const result = insertFabricTemplate(editor, "brainstorm", "undo-test");

    expect(result.ok).toBe(true);
    expect(markHistoryStoppingPoint).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toEqual({ history: "record" });
    expect(createShapes).toHaveBeenCalledOnce();
    expect(createdShapes[0]).toHaveLength(expectedShapeCounts.brainstorm);
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0]).toHaveLength(expectedShapeCounts.brainstorm);
    expect(squashToMark).toHaveBeenCalledOnce();
    expect(squashToMark).toHaveBeenCalledWith("history-mark");
    expect(zoomToSelection).toHaveBeenCalledWith({
      animation: { duration: 220 },
    });
    expect(markHistoryStoppingPoint.mock.invocationCallOrder[0]).toBeLessThan(
      run.mock.invocationCallOrder[0]!,
    );
    expect(run.mock.invocationCallOrder[0]).toBeLessThan(
      squashToMark.mock.invocationCallOrder[0]!,
    );
  });
});
