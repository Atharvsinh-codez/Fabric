import { describe, expect, it } from "vitest";

import type { JsonValue } from "@/db/schema/product";
import type { CanvasEdge, CanvasNode } from "@/lib/types";

import {
  createFabricTldrawDocument,
  legacyCanvasToTldrawShapeInputs,
  projectTldrawDocument,
  readTldrawDocument,
  TLDRAW_DOCUMENT_MAX_BYTES,
  TLDRAW_JSON_MAX_ENTRIES,
  TLDRAW_RECORD_MAX_BYTES,
  TldrawRecordBudget,
  tldrawRecordCollectionWithinLimits,
} from "./tldraw-document";

const legacyNodes: CanvasNode[] = [
  {
    id: "frame-1",
    type: "frame",
    title: "Evidence",
    x: 40,
    y: 60,
    width: 600,
    height: 400,
    fill: "#e0f2fe",
  },
  {
    id: "note-1",
    type: "note",
    title: "Customer signal",
    body: "People need a faster synthesis loop.",
    x: 80,
    y: 100,
    width: 200,
    height: 200,
    fill: "#e0f2fe",
    parentId: "frame-1",
  },
];
const legacyEdges: CanvasEdge[] = [
  {
    id: "edge-1",
    sourceId: "frame-1",
    targetId: "note-1",
    route: "elbow",
  },
];

function completeRecord(
  input: Record<string, unknown>,
  index: number,
): Record<string, unknown> & { id: string } {
  return {
    typeName: "shape",
    x: 0,
    y: 0,
    rotation: 0,
    index: `a${index + 1}`,
    parentId: "page:main",
    isLocked: false,
    opacity: 1,
    props: {},
    meta: {},
    ...input,
    id: String(input.id),
  };
}

function shapeRecord(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & { id: string } {
  return completeRecord({ id, type: "geo", ...overrides }, 0);
}

function recordWithExactBytes(id: string, bytes: number) {
  const record = shapeRecord(id, { props: { payload: "" } });
  const baseBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  return shapeRecord(id, {
    props: { payload: "x".repeat(bytes - baseBytes) },
  });
}

function nestedValue(wrappers: number): unknown {
  let value: unknown = 0;
  for (let index = 0; index < wrappers; index += 1) value = { next: value };
  return value;
}

describe("tldraw document adapter", () => {
  it("converts a legacy semantic canvas to tldraw inputs and projects it back", () => {
    const inputs = legacyCanvasToTldrawShapeInputs({
      nodes: legacyNodes,
      edges: legacyEdges,
    }) as unknown as Array<Record<string, unknown>>;
    const records = Object.fromEntries(
      inputs.map((input, index) => {
        const record = completeRecord(input, index);
        return [String(record.id), record];
      }),
    );
    const document = createFabricTldrawDocument({
      store: records,
      schema: { schemaVersion: 2, sequences: {} },
    });

    expect(document).not.toBeNull();
    const projected = projectTldrawDocument(document!);
    expect(projected.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "frame-1",
          type: "frame",
          title: "Evidence",
          width: 600,
          height: 400,
        }),
        expect.objectContaining({
          id: "note-1",
          type: "note",
          title: "Customer signal",
          body: "People need a faster synthesis loop.",
          parentId: "frame-1",
        }),
      ]),
    );
    expect(projected.edges).toEqual([
      expect.objectContaining({
        id: "edge-1",
        sourceId: "frame-1",
        targetId: "note-1",
        route: "elbow",
      }),
    ]);
  });

  it("accepts a staging editor snapshot by extracting only its document", () => {
    const input = legacyCanvasToTldrawShapeInputs({ nodes: legacyNodes, edges: [] })[0] as unknown as Record<string, unknown>;
    const record = completeRecord(input, 0);
    const stored = readTldrawDocument({
      version: 1,
      nodes: [],
      edges: [],
      tldrawSnapshot: {
        document: {
          store: { [String(record.id)]: record },
          schema: { schemaVersion: 2, sequences: {} },
        },
        session: { ignored: true },
      } as unknown as JsonValue,
    });

    expect(stored?.version).toBe(1);
    expect(Object.keys(stored?.snapshot.store ?? {})).toHaveLength(1);
  });

  it("falls back to the legacy projection when a tldraw payload is invalid or unbounded", () => {
    const invalid = readTldrawDocument({
      version: 1,
      nodes: legacyNodes as never,
      edges: [],
      tldraw: {
        version: 1,
        snapshot: {
          store: {
            "shape:bad": {
              id: "shape:different",
              typeName: "shape",
            },
          },
          schema: { schemaVersion: 2, sequences: {} },
        },
      },
    });

    expect(invalid).toBeNull();
  });

  it("projects pen dimensions from real segment point bounds", () => {
    const record = completeRecord(
      {
        id: "shape:pen-bounds",
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
            nodeId: "pen-bounds",
            nodeType: "drawing",
            title: "Pen stroke",
          },
        },
      },
      0,
    );
    const document = createFabricTldrawDocument({
      store: { [record.id]: record },
      schema: { schemaVersion: 2, sequences: {} },
    });

    expect(projectTldrawDocument(document!).nodes[0]).toMatchObject({
      id: "pen-bounds",
      type: "drawing",
      width: 150,
      height: 120,
      x: 50,
      y: 75,
    });
  });
});

describe("TldrawRecordBudget", () => {
  it("rejects a null persisted record instead of treating it as a deletion", () => {
    expect(TldrawRecordBudget.fromRecords([["shape:null", null]])).toBeNull();
  });

  it("updates only changed record costs and keeps add/update/delete accounting exact", () => {
    let unchangedReads = 0;
    const unchanged = shapeRecord("shape:unchanged");
    Object.defineProperty(unchanged, "meta", {
      configurable: true,
      enumerable: true,
      get: () => {
        unchangedReads += 1;
        return {};
      },
    });
    const changed = shapeRecord("shape:changed");
    const budget = TldrawRecordBudget.fromRecords([
      [unchanged.id, unchanged],
      [changed.id, changed],
    ]);
    expect(budget).not.toBeNull();

    unchangedReads = 0;
    const update = budget!.prepareChanges([
      [changed.id, { ...changed, x: 24 }],
    ]);
    expect(update.ok).toBe(true);
    expect(unchangedReads).toBe(0);
    if (!update.ok) return;
    update.commit();
    expect(budget!.recordCount).toBe(2);

    const added = shapeRecord("shape:added");
    const addition = budget!.prepareChanges([[added.id, added]]);
    expect(addition.ok).toBe(true);
    if (!addition.ok) return;
    addition.commit();
    expect(budget!.recordCount).toBe(3);

    const removal = budget!.prepareChanges([[unchanged.id, null]]);
    expect(removal.ok).toBe(true);
    if (!removal.ok) return;
    removal.commit();
    expect(budget!.recordCount).toBe(2);
    expect(
      tldrawRecordCollectionWithinLimits([
        [changed.id, { ...changed, x: 24 }],
        [added.id, added],
      ]),
    ).toBe(true);
  });

  it("preserves exact per-record and aggregate UTF-8 byte limits", () => {
    const exactRecord = recordWithExactBytes("shape:exact", TLDRAW_RECORD_MAX_BYTES);
    expect(TldrawRecordBudget.fromRecords([[exactRecord.id, exactRecord]])).not.toBeNull();
    const oversizedRecord = recordWithExactBytes(
      "shape:oversized",
      TLDRAW_RECORD_MAX_BYTES + 1,
    );
    expect(TldrawRecordBudget.fromRecords([[oversizedRecord.id, oversizedRecord]])).toBeNull();

    const records = Array.from({ length: 5 }, (_, index) => {
      const record = recordWithExactBytes(`shape:aggregate-${index}`, 150_000);
      return [record.id, record] as const;
    });
    const budget = TldrawRecordBudget.fromRecords(records);
    expect(budget?.byteCount).toBe(TLDRAW_DOCUMENT_MAX_BYTES);
    expect(tldrawRecordCollectionWithinLimits(records)).toBe(true);

    const first = records[0]!;
    const overAggregate = recordWithExactBytes(first[0], 150_001);
    const result = budget!.prepareChanges([[first[0], overAggregate]]);
    expect(result).toEqual({ ok: false, reason: "document_limit" });
    expect(budget!.byteCount).toBe(TLDRAW_DOCUMENT_MAX_BYTES);
  });

  it("counts the collection wrapper for exact JSON entry and depth limits", () => {
    const id = "shape:entries";
    const baseline = shapeRecord(id, { props: { values: [] } });
    const baselineBudget = TldrawRecordBudget.fromRecords([[id, baseline]])!;
    const remainingEntries = TLDRAW_JSON_MAX_ENTRIES - baselineBudget.jsonEntryCount;
    const exactEntries = shapeRecord(id, {
      props: { values: Array.from({ length: remainingEntries }, () => 0) },
    });
    const exactBudget = TldrawRecordBudget.fromRecords([[id, exactEntries]]);
    expect(exactBudget?.jsonEntryCount).toBe(TLDRAW_JSON_MAX_ENTRIES);
    expect(tldrawRecordCollectionWithinLimits([[id, exactEntries]])).toBe(true);

    const tooManyEntries = shapeRecord(id, {
      props: { values: Array.from({ length: remainingEntries + 1 }, () => 0) },
    });
    expect(exactBudget!.prepareChanges([[id, tooManyEntries]])).toEqual({
      ok: false,
      reason: "document_limit",
    });
    expect(tldrawRecordCollectionWithinLimits([[id, tooManyEntries]])).toBe(false);

    const exactDepth = shapeRecord("shape:depth", {
      props: { nested: nestedValue(37) },
    });
    expect(TldrawRecordBudget.fromRecords([[exactDepth.id, exactDepth]])).not.toBeNull();
    expect(tldrawRecordCollectionWithinLimits([[exactDepth.id, exactDepth]])).toBe(true);

    const tooDeepForCollection = shapeRecord("shape:depth", {
      props: { nested: nestedValue(38) },
    });
    const depthResult = TldrawRecordBudget.fromRecords([
      [tooDeepForCollection.id, exactDepth],
    ])!.prepareChanges([[tooDeepForCollection.id, tooDeepForCollection]]);
    expect(depthResult).toEqual({ ok: false, reason: "document_limit" });
    expect(
      tldrawRecordCollectionWithinLimits([
        [tooDeepForCollection.id, tooDeepForCollection],
      ]),
    ).toBe(false);
  });
});
