import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { BoardDocument, JsonValue } from "@/db/schema/product";
import {
  asStoredTldrawDocument,
  createFabricTldrawDocument,
} from "@/lib/boards/tldraw-document";
import {
  BOARD_THUMBNAIL_HEIGHT,
  BOARD_THUMBNAIL_WIDTH,
  buildBoardThumbnailSvg,
  renderBoardThumbnail,
} from "./board-thumbnail";

function completeShape(input: Record<string, unknown>) {
  return {
    typeName: "shape",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1",
    parentId: "page:main",
    isLocked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...input,
    id: String(input.id),
  };
}

describe("board thumbnail renderer", () => {
  it("rasterizes durable semantic geometry into a fixed private-preview size", async () => {
    const document: BoardDocument = {
      version: 1,
      nodes: [
        {
          id: "note-1",
          type: "note",
          title: "Roadmap <script>alert(1)</script>",
          x: 40,
          y: 60,
          width: 220,
          height: 140,
          fill: "url(https://attacker.invalid/pixel)",
          textColor: "#111827",
        },
        {
          id: "decision-1",
          type: "diamond",
          title: "Decision",
          x: 360,
          y: 100,
          width: 160,
          height: 120,
          fill: "#ede9fe",
        },
      ] as unknown as JsonValue,
      edges: [
        {
          id: "edge-1",
          sourceId: "note-1",
          targetId: "decision-1",
          route: "straight",
        },
      ] as unknown as JsonValue,
    };

    const svg = buildBoardThumbnailSvg(document);
    expect(svg).toContain("Roadmap &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(svg).not.toContain("attacker.invalid");
    expect(svg).toContain('marker-end="url(#fabric-thumbnail-arrow)"');

    const png = await renderBoardThumbnail(document);
    const metadata = await sharp(png).metadata();
    expect(metadata).toMatchObject({
      format: "png",
      width: BOARD_THUMBNAIL_WIDTH,
      height: BOARD_THUMBNAIL_HEIGHT,
    });
  });

  it("renders bounded drawing paths from a validated durable tldraw snapshot", () => {
    const record = completeShape({
      id: "shape:stroke",
      type: "draw",
      x: 50,
      y: 75,
      props: {
        scale: 1,
        color: "black",
        segments: [
          {
            type: "free",
            points: [
              { x: 20, y: 10, z: 0.4 },
              { x: 170, y: 130, z: 0.8 },
            ],
          },
        ],
      },
      meta: {
        fabric: {
          kind: "node",
          nodeId: "stroke",
          nodeType: "drawing",
          title: "Pen stroke",
        },
      },
    });
    const tldraw = createFabricTldrawDocument({
      store: { [record.id]: record },
      schema: { schemaVersion: 2, sequences: {} },
    });
    expect(tldraw).not.toBeNull();

    const svg = buildBoardThumbnailSvg({
      version: 1,
      nodes: [],
      edges: [],
      tldraw: asStoredTldrawDocument(tldraw!),
    });
    expect(svg).toMatch(/<path d="M50 75 L200 195"/u);
    expect(svg).not.toContain("Pen stroke</text>");
  });

  it("returns a neutral grid for an empty board", () => {
    const svg = buildBoardThumbnailSvg({ version: 1, nodes: [], edges: [] });
    expect(svg).toContain("fabric-thumbnail-grid");
    expect(svg).not.toContain("Evidence cluster");
    expect(svg.length).toBeLessThan(2_000);
  });
});
