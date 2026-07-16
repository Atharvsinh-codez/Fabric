import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AI_SELECTION_PREVIEW_MAX_DIMENSION,
  renderAiSelectionPreview,
} from "./selection-preview";

const drawing = {
  id: "drawing-1",
  type: "drawing" as const,
  title: "Authorized drawing",
  x: 20,
  y: 40,
  width: 300,
  height: 100,
  source: {
    shapeType: "draw" as const,
    segments: [
      {
        type: "free" as const,
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 40 },
          { x: 100, y: 20 },
        ],
      },
    ],
  },
};

describe("AI selection preview", () => {
  it("renders authorized vector source as a bounded PNG", async () => {
    const bytes = await renderAiSelectionPreview([drawing]);
    const metadata = await (await import("sharp")).default(bytes).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBeLessThanOrEqual(AI_SELECTION_PREVIEW_MAX_DIMENSION);
    expect(metadata.height).toBeLessThanOrEqual(AI_SELECTION_PREVIEW_MAX_DIMENSION);
    expect(metadata.channels).toBeGreaterThanOrEqual(3);
  });

  it("does not accept selection text without authorized drawing geometry", async () => {
    await expect(
      renderAiSelectionPreview([
        {
          id: "text-1",
          type: "text",
          title: "Do not turn this user string into SVG markup <script>",
          x: 0,
          y: 0,
          width: 100,
          height: 40,
        },
      ]),
    ).rejects.toThrow("no renderable drawing geometry");
  });
});
