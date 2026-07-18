import { describe, expect, it } from "vitest";

import type { CanvasPatch } from "./canvas-patch";
import { PEN_RENDERER_VERSION, renderPenText } from "./pen-renderer";
import type { CanvasDocumentSnapshot } from "../boards/canvas-document";
import {
  AiProposalApprovalRequestSchema,
  verifyApprovedPatchProjection,
} from "./approval";

const patch: CanvasPatch = {
  schemaVersion: 1,
  summary: "Group the research notes.",
  base: {
    workspaceId: "44444444-4444-4444-8444-444444444444",
    boardId: "55555555-5555-4555-8555-555555555555",
    documentGenerationId: "66666666-6666-4666-8666-666666666666",
    durableSequence: 7,
  },
  operations: [
    {
      type: "createNode",
      tempId: "tmp_theme",
      nodeType: "frame",
      position: { x: 40, y: 40 },
      size: { width: 640, height: 420 },
      content: { title: "Theme" },
      appearance: { fill: "fog" },
    },
    {
      type: "moveNode",
      nodeId: "node_1",
      position: { x: 80, y: 110 },
      parentId: "tmp_theme",
    },
    {
      type: "moveNode",
      nodeId: "node_2",
      position: { x: 320, y: 110 },
      parentId: "tmp_theme",
    },
  ],
};

const reflectedDocument = {
  nodes: [
    {
      id: "tmp_theme",
      type: "frame" as const,
      title: "Theme",
      x: 40,
      y: 40,
      width: 640,
      height: 420,
      fill: "#64748b",
    },
    {
      id: "node_1",
      type: "note" as const,
      title: "One",
      x: 80,
      y: 110,
      width: 200,
      height: 120,
      fill: "#ffffff",
      parentId: "tmp_theme",
    },
    {
      id: "node_2",
      type: "note" as const,
      title: "Two",
      x: 320,
      y: 110,
      width: 200,
      height: 120,
      fill: "#ffffff",
      parentId: "tmp_theme",
    },
  ],
  edges: [],
};

describe("AI approval binding", () => {
  it("accepts a strict run, patch, generation, base, and durable checkpoint binding", () => {
    expect(
      AiProposalApprovalRequestSchema.safeParse({
        runId: "22222222-2222-4222-8222-222222222222",
        patchHash: "a".repeat(64),
        documentGenerationId: patch.base.documentGenerationId,
        baseDurableSequence: 7,
        observedDurableSequence: 8,
      }).success,
    ).toBe(true);
    expect(
      AiProposalApprovalRequestSchema.safeParse({
        runId: "22222222-2222-4222-8222-222222222222",
        patchHash: "a".repeat(64),
        documentGenerationId: patch.base.documentGenerationId,
        baseDurableSequence: 7,
        observedDurableSequence: 8,
        boardId: patch.base.boardId,
      }).success,
    ).toBe(false);
    expect(
      AiProposalApprovalRequestSchema.safeParse({
        runId: "22222222-2222-4222-8222-222222222222",
        patchHash: "a".repeat(64),
        documentGenerationId: patch.base.documentGenerationId,
        baseDurableSequence: 0,
        observedDurableSequence: 0,
      }).success,
    ).toBe(true);
  });

  it("verifies the exact approved create and move results in the stored projection", () => {
    expect(verifyApprovedPatchProjection(patch, reflectedDocument)).toEqual({ ok: true });
  });

  it("rejects a lookalike projection without the auditable temporary id", () => {
    const lookalike = structuredClone(reflectedDocument);
    lookalike.nodes[0]!.id = "unrelated_frame";
    expect(verifyApprovedPatchProjection(patch, lookalike)).toEqual({
      ok: false,
      issueCodes: ["missing_created_node"],
    });
  });

  it("rejects stale positions or parent relationships", () => {
    const stale = structuredClone(reflectedDocument);
    stale.nodes[1]!.x = 81;
    stale.nodes[2]!.parentId = "another_frame";
    expect(verifyApprovedPatchProjection(patch, stale)).toEqual({
      ok: false,
      issueCodes: ["moved_node_mismatch"],
    });
  });

  it("accepts durable adapter metadata and normalizes an explicitly cleared body", () => {
    const metadataDocument = structuredClone(reflectedDocument) as CanvasDocumentSnapshot;
    metadataDocument.nodes[0]!.meta = "tldraw:geo";
    expect(verifyApprovedPatchProjection(patch, metadataDocument)).toEqual({ ok: true });

    const clearBodyPatch: CanvasPatch = {
      ...patch,
      operations: [{
        type: "updateNode",
        nodeId: "node_1",
        content: { body: "" },
      }],
    };
    const clearedDocument = structuredClone(reflectedDocument) as CanvasDocumentSnapshot;
    delete clearedDocument.nodes[1]!.body;
    expect(verifyApprovedPatchProjection(clearBodyPatch, clearedDocument)).toEqual({ ok: true });
  });

  it("accepts tldraw paragraph canonicalization without accepting changed text", () => {
    const paragraphPatch: CanvasPatch = {
      ...patch,
      operations: [{
        type: "createNode",
        tempId: "tmp_steps",
        nodeType: "note",
        position: { x: 40, y: 40 },
        size: { width: 320, height: 220 },
        content: {
          title: "Steps",
          body: "1. Receive\n\n2. Route\n\n3. Reply",
        },
      }],
    };
    const canonicalDocument: CanvasDocumentSnapshot = {
      nodes: [{
        id: "tmp_steps",
        type: "note",
        title: "Steps",
        body: "1. Receive\n2. Route\n3. Reply",
        x: 40,
        y: 40,
        width: 320,
        height: 220,
        fill: "#ffffff",
      }],
      edges: [],
    };

    expect(verifyApprovedPatchProjection(paragraphPatch, canonicalDocument)).toEqual({ ok: true });

    const changedDocument = structuredClone(canonicalDocument);
    changedDocument.nodes[0]!.body = "1. Receive\n2. Delete\n3. Reply";
    expect(verifyApprovedPatchProjection(paragraphPatch, changedDocument)).toEqual({
      ok: false,
      issueCodes: ["created_node_mismatch"],
    });
  });

  it("verifies the exact native draw record for deterministic pen writing", () => {
    const drawing = renderPenText({ text: "7 + 3 = 10", fontSize: 28, maxWidth: 360 });
    const penPatch: CanvasPatch = {
      ...patch,
      summary: "Write the answer with the pen.",
      operations: [{
        type: "writeText",
        tempId: "tmp_answer",
        position: { x: 120, y: 80 },
        text: "7 + 3 = 10",
        fontSize: 28,
        maxWidth: 360,
      }],
    };
    const penDocument = {
      nodes: [{
        id: "tmp_answer",
        type: "drawing",
        title: "7 + 3 = 10",
        body: "7 + 3 = 10",
        x: 120,
        y: 80,
        width: Math.max(8, drawing.width),
        height: Math.max(8, drawing.height),
        fill: "#111827",
      }],
      edges: [],
      tldraw: {
        version: 1,
        snapshot: {
          schema: {},
          store: {
            "shape:answer": {
              id: "shape:answer",
              typeName: "shape",
              type: "draw",
              props: {
                color: "black",
                fill: "none",
                size: "m",
                segments: drawing.segments,
                isComplete: true,
                isClosed: false,
                isPen: true,
              },
              meta: {
                fabric: {
                  nodeId: "tmp_answer",
                  penText: "7 + 3 = 10",
                  penFontSize: 28,
                  penMaxWidth: 360,
                  penRenderer: PEN_RENDERER_VERSION,
                  drawingFingerprint: drawing.fingerprint,
                },
              },
            },
          },
        },
      },
    } as unknown as CanvasDocumentSnapshot;

    expect(verifyApprovedPatchProjection(penPatch, penDocument)).toEqual({ ok: true });

    const tampered = structuredClone(penDocument);
    const record = tampered.tldraw!.snapshot.store["shape:answer"] as unknown as {
      props: { segments: Array<{ points: Array<{ x: number }> }> };
    };
    record.props.segments[0]!.points[0]!.x += 1;
    expect(verifyApprovedPatchProjection(penPatch, tampered)).toEqual({
      ok: false,
      issueCodes: ["native_drawing_mismatch"],
    });
  });
});
