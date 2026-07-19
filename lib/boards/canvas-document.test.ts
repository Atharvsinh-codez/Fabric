import { describe, expect, it } from "vitest";

import type { BoardDocument } from "@/db/schema/product";

import {
  documentFingerprint,
  prepareNewBoardDocument,
  readAuthoritativeCanvasDocument,
  readCanvasDocument,
  writeCanvasDocument,
} from "./canvas-document";

describe("canvas document persistence", () => {
  it("prepares Grid for new boards while preserving or overriding imported themes safely", () => {
    expect(prepareNewBoardDocument(undefined).theme).toBe("grid");
    expect(
      prepareNewBoardDocument({ version: 1, nodes: [], edges: [], theme: "sand" })
        .theme,
    ).toBe("sand");

    const imported: BoardDocument = {
      version: 1,
      nodes: [],
      edges: [],
      tldraw: {
        version: 1,
        snapshot: {
          store: {
            "document:document": {
              id: "document:document",
              typeName: "document",
              gridSize: 10,
              name: "",
              meta: { source: "template", fabricBoardTheme: "canvas" },
            },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
      },
    };

    const preserved = prepareNewBoardDocument(imported);
    expect(preserved.theme).toBe("canvas");
    expect(
      readCanvasDocument(preserved).theme,
    ).toBe("canvas");

    const overridden = prepareNewBoardDocument(imported, "grid");
    expect(overridden.theme).toBe("grid");
    expect(readCanvasDocument(overridden).theme).toBe("grid");
    expect(
      (
        (
          overridden.tldraw as {
            snapshot: { store: Record<string, { meta?: Record<string, unknown> }> };
          }
        ).snapshot.store["document:document"]?.meta
      )?.source,
    ).toBe("template");
  });

  it("loads valid nodes and only edges that connect loaded nodes", () => {
    const snapshot = readCanvasDocument({
      version: 1,
      nodes: [
        {
          id: "note-1",
          type: "note",
          title: "Signal",
          x: 10,
          y: 20,
          width: 180,
          height: 120,
          fill: "#ffffff",
        },
        {
          id: "note-1",
          type: "note",
          title: "Duplicate identifier",
          x: 40,
          y: 40,
          width: 180,
          height: 120,
          fill: "#ffffff",
        },
        { id: "broken", type: "note", title: "Missing geometry" },
      ],
      edges: [
        {
          id: "edge-1",
          sourceId: "note-1",
          targetId: "note-1",
          route: "elbow",
        },
        {
          id: "edge-2",
          sourceId: "note-1",
          targetId: "missing",
          route: "straight",
        },
      ],
    });

    expect(snapshot.nodes.map((node) => node.id)).toEqual(["note-1"]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(["edge-1"]);
    expect(snapshot.theme).toBe("canvas");
  });

  it("loads a validated theme and prefers lossless tldraw document metadata", () => {
    expect(
      readCanvasDocument({ version: 1, nodes: [], edges: [], theme: "sage" }).theme,
    ).toBe("sage");
    expect(
      readCanvasDocument({ version: 1, nodes: [], edges: [], theme: "unsupported" }).theme,
    ).toBe("canvas");

    const fromTldraw = readCanvasDocument({
      version: 1,
      nodes: [],
      edges: [],
      theme: "sand",
      tldraw: {
        version: 1,
        snapshot: {
          store: {
            "document:document": {
              id: "document:document",
              typeName: "document",
              gridSize: 10,
              name: "",
              meta: { fabricBoardTheme: "grid" },
            },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
      },
    });

    expect(fromTldraw.theme).toBe("grid");
  });

  it("preserves document metadata when writing canvas changes", () => {
    const document = writeCanvasDocument(
      { version: 1, settings: { grid: true }, nodes: [], edges: [] },
      {
        theme: "sky",
        nodes: [
          {
            id: "note-1",
            type: "note",
            title: "Signal",
            x: 0,
            y: 0,
            width: 180,
            height: 120,
            fill: "#ffffff",
          },
        ],
        edges: [],
      },
    );

    expect(document.settings).toEqual({ grid: true });
    expect(document.theme).toBe("sky");
    expect(document.nodes).toHaveLength(1);
  });

  it("uses a stable fingerprint for equivalent object key orders", () => {
    expect(documentFingerprint({ version: 1, nodes: [], edges: [] })).toBe(
      documentFingerprint({ edges: [], nodes: [], version: 1 }),
    );
  });

  it("preserves a tldraw checkpoint when a legacy editor writes only its projection", () => {
    const current: BoardDocument = {
      version: 1,
      nodes: [],
      edges: [],
      tldraw: {
        version: 1,
        snapshot: {
          store: {},
          schema: { schemaVersion: 2, sequences: {} },
        },
      },
    };
    const next = writeCanvasDocument(current, {
      nodes: [],
      edges: [],
      theme: "canvas",
    });

    expect(next.tldraw).toEqual(current.tldraw);
    expect(readCanvasDocument(next).tldraw?.version).toBe(1);
  });

  it("reprojects legacy semantic nodes from the current lossless tldraw checkpoint", () => {
    const document: BoardDocument = {
      version: 1,
      nodes: [{
        id: "rotated",
        type: "rectangle",
        title: "Stale projection",
        x: 20,
        y: 20,
        width: 160,
        height: 100,
        fill: "#e0f2fe",
      }],
      edges: [],
      tldraw: {
        version: 1,
        snapshot: {
          store: {
            "shape:rotated": {
              id: "shape:rotated",
              typeName: "shape",
              type: "geo",
              x: 20,
              y: 20,
              rotation: Math.PI / 4,
              index: "a1",
              parentId: "page:main",
              isLocked: false,
              opacity: 1,
              props: { geo: "rectangle", w: 160, h: 100 },
              meta: {
                fabric: {
                  kind: "node",
                  nodeId: "rotated",
                  nodeType: "rectangle",
                  title: "Current projection",
                },
              },
            },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
      },
    };

    expect(readCanvasDocument(document).nodes[0]).not.toHaveProperty("viewportWriteSafe");
    expect(readAuthoritativeCanvasDocument(document).nodes[0]).toMatchObject({
      id: "rotated",
      title: "Current projection",
      viewportWriteSafe: false,
    });
  });
});
