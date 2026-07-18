"use client";

import {
  loadSnapshot,
  type Editor,
  type TLStore,
  type TLStoreSnapshot,
} from "tldraw";

import type { CanvasDocumentSnapshot } from "@/lib/boards/canvas-document";
import {
  DEFAULT_BOARD_THEME,
  mergeBoardThemeMeta,
  readBoardThemeFromMeta,
  type BoardTheme,
} from "@/lib/boards/board-theme";
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
  const theme = readBoardThemeFromMeta(
    tldraw.snapshot.store["document:document"]?.meta,
  ) ?? DEFAULT_BOARD_THEME;
  return { ...projectTldrawDocument(tldraw), theme, tldraw };
}

function seedBoardTheme(editor: Editor, theme?: BoardTheme): void {
  const documentSettings = editor.getDocumentSettings();
  const storedTheme = readBoardThemeFromMeta(documentSettings.meta);
  const resolvedTheme = theme ?? storedTheme ?? DEFAULT_BOARD_THEME;
  if (storedTheme === resolvedTheme) return;

  const wasReadonly = editor.getInstanceState().isReadonly;
  if (wasReadonly) editor.updateInstanceState({ isReadonly: false });
  try {
    editor.updateDocumentSettings({
      meta: mergeBoardThemeMeta(documentSettings.meta, resolvedTheme),
    });
  } finally {
    if (wasReadonly) editor.updateInstanceState({ isReadonly: true });
  }
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
  legacyCanvas: Pick<CanvasDocumentSnapshot, "nodes" | "edges" | "theme">;
}): TldrawHydrationResult {
  const { editor, tldraw, legacyCanvas } = input;
  if (tldraw) {
    const previous = editor.store.getStoreSnapshot("document");
    try {
      // loadSnapshot performs tldraw's schema migrations before the records are accepted.
      loadSnapshot(editor.store, tldraw.snapshot as unknown as TLStoreSnapshot);
      seedBoardTheme(editor, legacyCanvas.theme);
      return {
        source: "stored-tldraw",
        migratedFromLegacy: false,
        warning: null,
      };
    } catch {
      // Never leave a partially migrated document in the editor.
      editor.store.loadStoreSnapshot(previous);
      const importedShapeCount = importLegacyCanvasIntoTldrawEditor(editor, legacyCanvas);
      seedBoardTheme(editor, legacyCanvas.theme);
      return {
        source: importedShapeCount > 0 ? "legacy-canvas" : "empty",
        migratedFromLegacy: importedShapeCount > 0,
        warning:
          "The stored tldraw checkpoint was incompatible, so Fabric recovered its semantic canvas projection.",
      };
    }
  }

  const importedShapeCount = importLegacyCanvasIntoTldrawEditor(editor, legacyCanvas);
  seedBoardTheme(editor, legacyCanvas.theme);
  return {
    source: importedShapeCount > 0 ? "legacy-canvas" : "empty",
    migratedFromLegacy: importedShapeCount > 0,
    warning: null,
  };
}
