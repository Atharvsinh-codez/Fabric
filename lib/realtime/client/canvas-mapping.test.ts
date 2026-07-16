import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  getCanvasTypes,
  readCanvasFromYDoc,
  writeCanvasToYDoc,
} from "./canvas-mapping";

describe("canvas Yjs mapping", () => {
  it("does not mutate a document while reading an uninitialized adapter", () => {
    const document = new Y.Doc();
    let updates = 0;
    document.on("update", () => {
      updates += 1;
    });

    expect(readCanvasFromYDoc(document)).toEqual({
      nodes: [],
      edges: [],
      rejectedNodeIds: [],
      rejectedEdgeIds: [],
    });
    expect(updates).toBe(0);
  });

  it("round-trips safe nodes and edges with stable IDs and order", () => {
    const document = new Y.Doc();
    writeCanvasToYDoc(document, {
      nodes: [
        {
          id: "node-a",
          type: "note",
          title: "Evidence",
          body: "People need a clearer handoff.",
          x: 24,
          y: 48,
          width: 220,
          height: 132,
          fill: "#ffedb7",
        },
        {
          id: "node-b",
          type: "summary",
          title: "Direction",
          x: 340,
          y: 48,
          width: 260,
          height: 160,
          fill: "#1e2430",
          textColor: "#ffffff",
        },
      ],
      edges: [
        { id: "edge-a", sourceId: "node-a", targetId: "node-b", route: "elbow" },
      ],
    });

    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(document));
    const result = readCanvasFromYDoc(replica);

    expect(result.nodes.map((node) => node.id)).toEqual(["node-a", "node-b"]);
    expect(result.edges).toEqual([
      { id: "edge-a", sourceId: "node-a", targetId: "node-b", route: "elbow" },
    ]);
    expect(result.rejectedNodeIds).toEqual([]);
    expect(result.rejectedEdgeIds).toEqual([]);
  });

  it("does not expose arbitrary style or executable fields", () => {
    const document = new Y.Doc();
    const types = getCanvasTypes(document);
    const unsafe = new Y.Map<unknown>();
    for (const [key, value] of Object.entries({
      id: "unsafe-node",
      type: "note",
      title: "Unsafe",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fill: "url(javascript:alert(1))",
      style: { position: "fixed" },
    })) {
      unsafe.set(key, value);
    }
    document.transact(() => {
      types.nodes.set("unsafe-node", unsafe);
      types.nodeOrder.push(["unsafe-node"]);
    });

    const result = readCanvasFromYDoc(document);
    expect(result.nodes).toEqual([]);
    expect(result.rejectedNodeIds).toEqual(["unsafe-node"]);
  });

  it("rejects edges that do not reference accepted nodes", () => {
    const document = new Y.Doc();
    expect(() =>
      writeCanvasToYDoc(document, {
        nodes: [],
        edges: [
          { id: "edge-a", sourceId: "missing-a", targetId: "missing-b", route: "straight" },
        ],
      }),
    ).toThrow();
  });
});
