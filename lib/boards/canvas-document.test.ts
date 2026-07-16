import { describe, expect, it } from "vitest";

import type { BoardDocument } from "@/db/schema/product";

import {
  documentFingerprint,
  readCanvasDocument,
  writeCanvasDocument,
} from "./canvas-document";

describe("canvas document persistence", () => {
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
  });

  it("preserves document metadata when writing canvas changes", () => {
    const document = writeCanvasDocument(
      { version: 1, settings: { grid: true }, nodes: [], edges: [] },
      {
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
    const next = writeCanvasDocument(current, { nodes: [], edges: [] });

    expect(next.tldraw).toEqual(current.tldraw);
    expect(readCanvasDocument(next).tldraw?.version).toBe(1);
  });
});
