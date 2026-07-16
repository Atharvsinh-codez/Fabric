import { describe, expect, it } from "vitest";

import { CanvasPatchSchema } from "./canvas-patch";
import { normalizeCanvasPatchCandidate } from "./canvas-patch-normalizer";

const base = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  documentGenerationId: "33333333-3333-4333-8333-333333333333",
  durableSequence: 7,
  selectionHash: "a".repeat(64),
};

describe("CanvasPatch provider compatibility", () => {
  it("leaves canonical patches untouched", () => {
    const canonical = {
      schemaVersion: 1,
      summary: "Write the answer.",
      base,
      operations: [{
        type: "writeText",
        tempId: "tmp_answer",
        position: { x: 120, y: 240 },
        text: "42",
        fontSize: 28,
        maxWidth: 640,
      }],
    };

    expect(normalizeCanvasPatchCandidate(canonical)).toEqual({
      value: canonical,
      compatibilityMode: "none",
    });
  });

  it("normalizes the exact compact writeText shape observed in production", () => {
    const compact = {
      schemaVersion: 1,
      summary: "Write the solution steps.",
      ...base,
      ops: [
        { type: "writeText", id: "tmp_step", x: 120, y: 240, text: "Step one" },
        {
          type: "writeText",
          id: "tmp_result",
          x: 120,
          y: 320,
          text: "Result",
          fontSize: 32,
          maxWidth: 800,
          color: "ink",
        },
      ],
    };

    const normalized = normalizeCanvasPatchCandidate(compact);
    expect(normalized.compatibilityMode).toBe("compact_write_text_v1");
    expect(CanvasPatchSchema.safeParse(normalized.value).success).toBe(true);
    expect(normalized.value).toMatchObject({
      base,
      operations: [
        {
          type: "writeText",
          tempId: "tmp_step",
          position: { x: 120, y: 240 },
          fontSize: 28,
          maxWidth: 640,
        },
        {
          type: "writeText",
          tempId: "tmp_result",
          position: { x: 120, y: 320 },
          fontSize: 32,
          maxWidth: 800,
          color: "ink",
        },
      ],
    });
  });

  it("does not normalize mixed, unknown, or extra provider fields", () => {
    const withExtraField = {
      schemaVersion: 1,
      summary: "Unsafe alias expansion.",
      ...base,
      ops: [{
        type: "writeText",
        id: "tmp_answer",
        x: 10,
        y: 20,
        text: "Answer",
        html: "<b>Answer</b>",
      }],
    };
    const unsupportedOperation = {
      schemaVersion: 1,
      summary: "Unsupported compact operation.",
      ...base,
      ops: [{ type: "deleteNode", id: "node_1" }],
    };

    expect(normalizeCanvasPatchCandidate(withExtraField)).toEqual({
      value: withExtraField,
      compatibilityMode: "none",
    });
    expect(normalizeCanvasPatchCandidate(unsupportedOperation)).toEqual({
      value: unsupportedOperation,
      compatibilityMode: "none",
    });
    expect(CanvasPatchSchema.safeParse(withExtraField).success).toBe(false);
    expect(CanvasPatchSchema.safeParse(unsupportedOperation).success).toBe(false);
  });

  it("does not replace explicit invalid values with presentation defaults", () => {
    const compact = {
      schemaVersion: 1,
      summary: "Invalid explicit layout values.",
      ...base,
      ops: [{
        type: "writeText",
        id: "tmp_answer",
        x: 10,
        y: 20,
        text: "Answer",
        fontSize: null,
        maxWidth: null,
      }],
    };

    const normalized = normalizeCanvasPatchCandidate(compact);
    expect(normalized.compatibilityMode).toBe("compact_write_text_v1");
    expect(CanvasPatchSchema.safeParse(normalized.value).success).toBe(false);
  });
});
