"use client";

import {
  loadSnapshot,
  type Editor,
  type TLStore,
  type TLStoreSnapshot,
} from "tldraw";

import type { CanvasDocumentSnapshot } from "@/lib/boards/canvas-document";
import {
  createFabricTldrawDocument,
  legacyCanvasToTldrawShapeInputs,
  projectTldrawDocument,
  type FabricTldrawDocument,
  type TldrawCanvasProjection,
} from "./tldraw-document";

export type TldrawHydrationResult = Readonly<{
  source: "stored-tldraw" | "legacy-canvas" | "empty";
  migratedFromLegacy: boolean;
  warning: string | null;
}>;

export type TldrawCheckpoint = CanvasDocumentSnapshot & Readonly<{
  tldraw: FabricTldrawDocument;
}>;

export function captureTldrawDocument(store: TLStore): FabricTldrawDocument {
  const document = createFabricTldrawDocument(store.getStoreSnapshot("document"));
  if (!document) {
    throw new Error("The tldraw document exceeds Fabric's checkpoint safety limits.");
  }
  return document;
}

export function captureTldrawCheckpoint(store: TLStore): TldrawCheckpoint {
  const tldraw = captureTldrawDocument(store);
  return { ...projectTldrawDocument(tldraw), tldraw };
}

export function importLegacyCanvasIntoTldrawEditor(
  editor: Editor,
  canvas: TldrawCanvasProjection,
  options: { force?: boolean } = {},
): number {
  if (!options.force && editor.getCurrentPageShapeIds().size > 0) return 0;
  const shapes = legacyCanvasToTldrawShapeInputs(canvas);
  if (shapes.length > 0) {
    const wasReadonly = editor.getInstanceState().isReadonly;
    if (wasReadonly) editor.updateInstanceState({ isReadonly: false });
    try {
      editor.createShapes(shapes);
    } finally {
      if (wasReadonly) editor.updateInstanceState({ isReadonly: true });
    }
  }
  return shapes.length;
}

export function hydrateTldrawEditor(input: {
  editor: Editor;
  tldraw: FabricTldrawDocument | null | undefined;
  legacyCanvas: Pick<CanvasDocumentSnapshot, "nodes" | "edges">;
}): TldrawHydrationResult {
  const { editor, tldraw, legacyCanvas } = input;
  if (tldraw) {
    const previous = editor.store.getStoreSnapshot("document");
    try {
      // loadSnapshot performs tldraw's schema migrations before the records are accepted.
      loadSnapshot(editor.store, tldraw.snapshot as unknown as TLStoreSnapshot);
      return {
        source: "stored-tldraw",
        migratedFromLegacy: false,
        warning: null,
      };
    } catch {
      // Never leave a partially migrated document in the editor.
      editor.store.loadStoreSnapshot(previous);
      const importedShapeCount = importLegacyCanvasIntoTldrawEditor(editor, legacyCanvas);
      return {
        source: importedShapeCount > 0 ? "legacy-canvas" : "empty",
        migratedFromLegacy: importedShapeCount > 0,
        warning:
          "The stored tldraw checkpoint was incompatible, so Fabric recovered its semantic canvas projection.",
      };
    }
  }

  const importedShapeCount = importLegacyCanvasIntoTldrawEditor(editor, legacyCanvas);
  return {
    source: importedShapeCount > 0 ? "legacy-canvas" : "empty",
    migratedFromLegacy: importedShapeCount > 0,
    warning: null,
  };
}
