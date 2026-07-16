import { describe, expect, it } from "vitest";

import { normalizePenDrawing, renderPenText } from "./pen-renderer";

describe("deterministic pen renderer", () => {
  it("renders the same text to identical normalized segments and fingerprint", () => {
    const input = { text: "x + 2 = 7\nx = 5", fontSize: 28, maxWidth: 480 };
    expect(renderPenText(input)).toEqual(renderPenText(input));
  });

  it("computes dimensions from real point bounds", () => {
    const drawing = normalizePenDrawing([
      {
        type: "free",
        points: [
          { x: 40, y: 30, z: 0.4 },
          { x: 190, y: 80, z: 0.7 },
          { x: 100, y: 150, z: 0.5 },
        ],
      },
    ]);
    expect(drawing.width).toBe(150);
    expect(drawing.height).toBe(120);
    expect(drawing.segments[0]?.points).toEqual([
      { x: 0, y: 0, z: 0.4 },
      { x: 150, y: 50, z: 0.7 },
      { x: 60, y: 120, z: 0.5 },
    ]);
  });
});
