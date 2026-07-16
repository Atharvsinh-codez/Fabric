"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  createTLStore,
  type Editor,
  type TLStoreSnapshot,
} from "tldraw";

import type { FabricWhiteboardDocumentAdapter } from "@/components/fabric-whiteboard";
import type { FabricWhiteboardAiAdapter } from "@/components/fabric-whiteboard/ai-panel";
import type { CanvasDocumentSnapshot } from "@/lib/boards/canvas-document";
import { createFabricTldrawAssetStore } from "@/lib/boards/tldraw-asset-store";
import { tldrawWhiteboardAiAdapter } from "@/lib/boards/tldraw-ai-adapter";
import {
  captureTldrawCheckpoint,
  hydrateTldrawEditor,
  type TldrawCheckpoint,
} from "@/lib/boards/tldraw-store-adapter";
import type { RealtimeCapability } from "@/lib/realtime/constants";
import {
  TldrawCollaborationController,
  type TldrawCollaborationControllerOptions,
  type TldrawCollaborationError,
} from "@/lib/realtime/client/tldraw-controller";
import type {
  RealtimeAwarenessState,
  RealtimeConnectionState,
} from "@/lib/realtime/client/types";

export type FabricWhiteboardAdapterOptions = Readonly<{
  principalId: string;
  boardId: string;
  documentGenerationId: string;
  documentKey: string | number;
  canEdit: boolean;
  mediaUploadsEnabled?: boolean;
  connectRealtime?: boolean;
  initialCanvas: CanvasDocumentSnapshot;
  onCheckpoint?: (checkpoint: TldrawCheckpoint) => void;
  ai?: FabricWhiteboardAiAdapter;
  realtime?: TldrawCollaborationControllerOptions["realtime"];
}>;

type StoreState = Readonly<{
  store: ReturnType<typeof createTLStore>;
  loadedStoredDocument: boolean;
  warning: string | null;
  initialCanvas: CanvasDocumentSnapshot;
}>;

function createInitialStore(
  canvas: CanvasDocumentSnapshot,
  boardId: string,
  mediaUploadsEnabled: boolean,
): StoreState {
  const assets = createFabricTldrawAssetStore({
    boardId,
    r2UploadsEnabled: mediaUploadsEnabled,
  });
  if (!canvas.tldraw) {
    return {
      store: createTLStore({ assets }),
      loadedStoredDocument: false,
      warning: null,
      initialCanvas: canvas,
    };
  }
  try {
    return {
      store: createTLStore({
        assets,
        snapshot: canvas.tldraw.snapshot as unknown as TLStoreSnapshot,
      }),
      loadedStoredDocument: true,
      warning: null,
      initialCanvas: canvas,
    };
  } catch {
    return {
      store: createTLStore({ assets }),
      loadedStoredDocument: false,
      warning:
        "The tldraw checkpoint could not be migrated, so Fabric recovered its semantic canvas projection.",
      initialCanvas: canvas,
    };
  }
}

/**
 * Creates the exact adapter consumed by `FabricWhiteboard`. Pass the board
 * persistence hook's `queueTldrawChange` as this hook's `onCheckpoint` and a
 * no-op as the shell's `onDocumentChange`; the controller checkpoints validated
 * local store changes. Remote collaborators do not race duplicate HTTP writes.
 * Realtime ACK state below remains
 * deliberately independent from the HTTP checkpoint state.
 */
export function useFabricWhiteboardAdapter(
  options: FabricWhiteboardAdapterOptions,
) {
  const {
    principalId,
    boardId,
    documentGenerationId,
    documentKey,
    canEdit,
    mediaUploadsEnabled = true,
    connectRealtime = true,
    initialCanvas,
    onCheckpoint,
    ai = tldrawWhiteboardAiAdapter,
    realtime,
  } = options;
  const controllerRef = useRef<TldrawCollaborationController | null>(null);
  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>("idle");
  const [capabilities, setCapabilities] = useState<readonly RealtimeCapability[]>([]);
  const [awareness, setAwareness] = useState<
    ReadonlyMap<number, RealtimeAwarenessState>
  >(new Map());
  const [error, setError] = useState<TldrawCollaborationError | null>(null);
  const [hydrationWarning, setHydrationWarning] = useState<string | null>(null);
  const [pendingAcknowledgements, setPendingAcknowledgements] = useState(0);
  const [lastAcknowledgedSequence, setLastAcknowledgedSequence] = useState(0);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [localAwarenessClientId, setLocalAwarenessClientId] = useState<number | null>(null);

  // `initialCanvas` is intentionally captured only when the server load key
  // changes. Local checkpoints must not recreate the mounted tldraw store.
  const storeState = useMemo(
    () => createInitialStore(initialCanvas, boardId, mediaUploadsEnabled),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [boardId, documentGenerationId, documentKey, mediaUploadsEnabled],
  );

  const onMount = useCallback((editor: Editor) => {
    let disposed = false;
    setPendingAcknowledgements(0);
    setError(null);
    setHydrationWarning(storeState.warning);

    if (!storeState.loadedStoredDocument) {
      const hydration = hydrateTldrawEditor({
        editor,
        tldraw: null,
        legacyCanvas: storeState.initialCanvas,
      });
      if (hydration.warning) setHydrationWarning(hydration.warning);
    }

    if (!connectRealtime) {
      setConnectionState("connected");
      setCapabilities(["read"]);
      setWriteEnabled(false);
      return () => {
        disposed = true;
        setCapabilities([]);
        setConnectionState("stopped");
      };
    }

    const controller = new TldrawCollaborationController({
      store: editor.store,
      principalId,
      boardId,
      documentGenerationId,
      canEdit,
      checkpointDebounceMs: 2_000,
      checkpointSource: "local",
      onCheckpoint,
      realtime,
      onAwarenessChange: (states) => {
        if (!disposed) setAwareness(states);
      },
      onCapabilitiesChange: (nextCapabilities) => {
        if (!disposed) {
          setCapabilities([...nextCapabilities]);
          setWriteEnabled(controllerRef.current?.isWriteEnabled() ?? false);
        }
      },
      onConnectionStateChange: (state) => {
        if (!disposed) {
          setConnectionState(state);
          setWriteEnabled(controllerRef.current?.isWriteEnabled() ?? false);
        }
      },
      onError: (nextError) => {
        if (!disposed) setError(nextError);
      },
      onPendingAcknowledgementCountChange: (count) => {
        if (!disposed) setPendingAcknowledgements(count);
      },
      onUpdateAcknowledged: (_messageId, sequence) => {
        if (!disposed) {
          setLastAcknowledgedSequence(sequence);
        }
      },
    });
    controllerRef.current = controller;
    setLocalAwarenessClientId(controller.realtime.awareness.awareness.clientID);
    void controller.start().then(() => {
      if (!disposed) setWriteEnabled(controller.isWriteEnabled());
    }).catch(() => {
      if (!disposed) {
        setConnectionState("error");
        setError({
          source: "realtime",
          code: "start_failed",
          message: "Fabric could not start this board's realtime session.",
          permanent: false,
        });
      }
    });

    return () => {
      disposed = true;
      if (controllerRef.current === controller) controllerRef.current = null;
      setLocalAwarenessClientId(null);
      void controller.destroy();
    };
  }, [
    boardId,
    canEdit,
    connectRealtime,
    documentGenerationId,
    onCheckpoint,
    principalId,
    realtime,
    storeState,
  ]);

  const documentAdapter = useMemo<FabricWhiteboardDocumentAdapter>(() => ({
    source: { kind: "store", store: storeState.store },
    toCanvasDocument: (editor) => captureTldrawCheckpoint(editor.store),
    ai,
    onMount,
  }), [ai, onMount, storeState.store]);

  const setAwarenessState = useCallback((state: RealtimeAwarenessState | null) => {
    controllerRef.current?.setAwarenessState(state);
  }, []);

  return {
    documentAdapter,
    realtime: {
      connectionState,
      capabilities,
      awareness,
      error,
      pendingAcknowledgements,
      lastAcknowledgedSequence,
      writeEnabled,
      localAwarenessClientId,
      setAwarenessState,
    },
    hydrationWarning,
  } as const;
}
