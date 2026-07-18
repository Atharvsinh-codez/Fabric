"use client";

import { useMemo } from "react";
import {
  createTLStore,
  Tldraw,
  type TLComponents,
  type TLStoreSnapshot,
} from "tldraw";

import { FabricCanvasBackground } from "@/components/fabric-whiteboard/canvas-chrome";
import type { PublicBoardShare } from "@/lib/boards/public-share";
import {
  BOARD_ASSET_MAX_BYTES,
  SUPPORTED_BOARD_IMAGE_MIME_TYPES,
  SUPPORTED_BOARD_VIDEO_MIME_TYPES,
} from "@/lib/boards/assets/contracts";
import { createFabricTldrawAssetStore } from "@/lib/boards/tldraw-asset-store";
import { importLegacyCanvasIntoTldrawEditor } from "@/lib/boards/tldraw-store-adapter";
import { mergeBoardThemeMeta } from "@/lib/boards/board-theme";

const sharedComponents: TLComponents = {
  Background: FabricCanvasBackground,
  ActionsMenu: null,
  ContextMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  HelperButtons: null,
  ImageToolbar: null,
  MainMenu: null,
  MenuPanel: null,
  PageMenu: null,
  QuickActions: null,
  RichTextToolbar: null,
  SharePanel: null,
  StylePanel: null,
  Toolbar: null,
  VideoToolbar: null,
};

export function SharedTldrawCanvas({ share }: { share: PublicBoardShare }) {
  const source = useMemo(() => {
    const assets = createFabricTldrawAssetStore({
      boardId: share.boardId,
      access: { kind: "share", token: share.token },
    });
    if (share.tldraw) {
      try {
        return {
          store: createTLStore({
            assets,
            snapshot: share.tldraw.snapshot as unknown as TLStoreSnapshot,
          }),
          needsLegacySeed: false,
        };
      } catch {
        // A validated semantic projection is still available for recovery.
      }
    }
    return { store: createTLStore({ assets }), needsLegacySeed: true };
  }, [share.boardId, share.tldraw, share.token]);

  return (
    <section
      id="shared-canvas-view"
      aria-label={`Read-only canvas view of ${share.title}`}
      className="fabric-tldraw relative min-h-0 flex-1 overflow-hidden bg-surface-white"
    >
      <Tldraw
        store={source.store}
        components={sharedComponents}
        maxAssetSize={BOARD_ASSET_MAX_BYTES}
        acceptedImageMimeTypes={SUPPORTED_BOARD_IMAGE_MIME_TYPES}
        acceptedVideoMimeTypes={SUPPORTED_BOARD_VIDEO_MIME_TYPES}
        onMount={(editor) => {
          if (source.needsLegacySeed) {
            importLegacyCanvasIntoTldrawEditor(editor, {
              nodes: share.nodes,
              edges: share.edges,
            });
          }
          editor.updateDocumentSettings({
            meta: mergeBoardThemeMeta(editor.getDocumentSettings().meta, share.theme),
          });
          editor.selectNone();
          editor.updateInstanceState({ isReadonly: true });
          const frame = window.requestAnimationFrame(() => editor.zoomToFit());
          return () => {
            window.cancelAnimationFrame(frame);
          };
        }}
      />
    </section>
  );
}
