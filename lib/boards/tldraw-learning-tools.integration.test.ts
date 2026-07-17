// @vitest-environment happy-dom

import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import {
  createTLStore,
  defaultBindingUtils,
  defaultShapeUtils,
  Editor,
  type TLShapeId,
} from "tldraw";
import { describe, expect, it } from "vitest";

import { sampleStemGraph } from "./stem-math";
import {
  buildEducationTemplate,
  EDUCATION_TEMPLATE_IDS,
} from "./tldraw-education-templates";
import {
  buildStemGraph,
  buildStemInstrument,
  STEM_INSTRUMENT_IDS,
} from "./tldraw-stem-tools";

describe("native learning-tool records", () => {
  it("round-trips every template, instrument, and graph through a real tldraw 4.2 store", () => {
    const shapeUtils = [...defaultShapeUtils];
    const bindingUtils = [...defaultBindingUtils];
    const store = createTLStore({ shapeUtils, bindingUtils });
    const container = document.createElement("div");
    document.body.append(container);
    const editor = new Editor({
      store,
      shapeUtils,
      bindingUtils,
      tools: [],
      getContainer: () => container,
      textOptions: {
        addFontsFromNode: (_node, state) => state,
        tipTapConfig: { extensions: [Document, Paragraph, Text] },
      },
    });

    try {
      const shapeIds: TLShapeId[] = [];
      EDUCATION_TEMPLATE_IDS.forEach((templateId, index) => {
        const built = buildEducationTemplate(templateId, {
          center: { x: index * 1_800, y: 0 },
          instanceId: `real-${templateId}`,
        });
        editor.createShapes([...built.shapes]);
        shapeIds.push(...built.shapeIds);
      });
      STEM_INSTRUMENT_IDS.forEach((instrumentId, index) => {
        const built = buildStemInstrument(instrumentId, {
          center: { x: index * 1_100, y: 1_500 },
          instanceId: `real-${instrumentId}`,
        });
        editor.createShapes([...built.shapes]);
        shapeIds.push(...built.shapeIds);
      });
      const graph = sampleStemGraph({
        expression: "sin(x) + 0.25x",
        xMin: -10,
        xMax: 10,
        yMin: -5,
        yMax: 5,
      });
      if (!graph.ok) throw new Error(graph.message);
      const builtGraph = buildStemGraph(graph, {
        center: { x: 4_000, y: 1_500 },
        instanceId: "real-graph",
      });
      editor.createShapes([...builtGraph.shapes]);
      shapeIds.push(...builtGraph.shapeIds);

      expect(new Set(shapeIds).size).toBe(shapeIds.length);
      expect(shapeIds.length).toBeLessThan(150);
      shapeIds.forEach((shapeId) => {
        const shape = editor.getShape(shapeId);
        expect(shape).toBeDefined();
        expect(["arrow", "draw", "geo", "text"]).toContain(shape?.type);
      });
    } finally {
      editor.dispose();
      container.remove();
    }
  });
});
