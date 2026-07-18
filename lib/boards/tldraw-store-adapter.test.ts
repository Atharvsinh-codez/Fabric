// @vitest-environment happy-dom

import {
  createTLStore,
  DocumentRecordType,
  TLDOCUMENT_ID,
  type Editor,
  type TLDocument,
} from "tldraw";
import { describe, expect, it, vi } from "vitest";

import {
  captureTldrawCheckpoint,
  hydrateTldrawEditor,
} from "./tldraw-store-adapter";

describe("tldraw board theme persistence", () => {
  it("captures the global document theme with the lossless checkpoint", () => {
    const store = createTLStore();
    const document = DocumentRecordType.create({
      id: TLDOCUMENT_ID,
      meta: { source: "lesson", fabricBoardTheme: "sage" },
    });
    store.put([document]);

    const checkpoint = captureTldrawCheckpoint(store);

    expect(checkpoint.theme).toBe("sage");
    expect(
      checkpoint.tldraw.snapshot.store["document:document"]?.meta,
    ).toEqual({ source: "lesson", fabricBoardTheme: "sage" });
  });

  it("seeds a selected legacy theme through the public document settings API", () => {
    let documentSettings: TLDocument = DocumentRecordType.create({
      id: TLDOCUMENT_ID,
      meta: { source: "creation" },
    });
    let readonly = true;
    const updateInstanceState = vi.fn((next: { isReadonly?: boolean }) => {
      if (next.isReadonly !== undefined) readonly = next.isReadonly;
    });
    const updateDocumentSettings = vi.fn((next: Partial<TLDocument>) => {
      documentSettings = { ...documentSettings, ...next };
    });
    const editor = {
      getCurrentPageShapeIds: () => new Set(),
      getDocumentSettings: () => documentSettings,
      getInstanceState: () => ({ isReadonly: readonly }),
      updateDocumentSettings,
      updateInstanceState,
    } as unknown as Editor;

    const result = hydrateTldrawEditor({
      editor,
      tldraw: null,
      legacyCanvas: { nodes: [], edges: [], theme: "sky" },
    });

    expect(result.source).toBe("empty");
    expect(updateDocumentSettings).toHaveBeenCalledWith({
      meta: { source: "creation", fabricBoardTheme: "sky" },
    });
    expect(updateInstanceState).toHaveBeenNthCalledWith(1, { isReadonly: false });
    expect(updateInstanceState).toHaveBeenNthCalledWith(2, { isReadonly: true });
    expect(readonly).toBe(true);
  });
});
