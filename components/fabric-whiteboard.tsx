"use client";

import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  BookmarkSquareIcon,
  ChatBubbleLeftRightIcon,
  RectangleStackIcon,
  ShareIcon,
} from "@heroicons/react/16/solid";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Tldraw,
  type Editor,
  type TLEditorSnapshot,
  type TLStore,
  type TLStoreSnapshot,
  type TLStoreWithStatus,
} from "tldraw";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  FabricAiPanel,
  type FabricWhiteboardAiAdapter,
} from "@/components/fabric-whiteboard/ai-panel";
import { FabricBoardThemePicker } from "@/components/fabric-whiteboard/board-theme-picker";
import { FabricBoardToolsPanel } from "@/components/fabric-whiteboard/board-tools-panel";
import { fabricCanvasComponents } from "@/components/fabric-whiteboard/canvas-chrome";
import { FabricCheckpointDialog } from "@/components/fabric-whiteboard/checkpoint-dialog";
import { FabricCommentsPanel } from "@/components/fabric-whiteboard/comments-panel";
import { FabricDialog } from "@/components/fabric-whiteboard/fabric-dialog";
import { FabricExportDialog } from "@/components/fabric-whiteboard/export-dialog";
import {
  PresenceSummary,
  remotePresenceEntries,
} from "@/components/fabric-whiteboard/presence-summary";
import { FabricShareDialog } from "@/components/fabric-whiteboard/share-dialog";
import {
  boardSyncLabel,
  FabricAiTrigger,
  shouldOpenSyncRecoveryOnLeave,
} from "@/components/fabric-whiteboard/status-controls";
import { Button, IconButton } from "@/components/ui";
import type {
  BoardSharingPolicy,
  CommentAnchor,
  WorkspaceRole,
} from "@/db/schema/product";
import type { CanvasDocumentSnapshot } from "@/lib/boards/canvas-document";
import {
  canCommentOnBoardState,
  canEditBoardState,
} from "@/lib/boards/board-state";
import type { BoardSyncState } from "@/lib/boards/use-board-document";
import type { AgentBoardReadinessState } from "@/lib/boards/collaborative-sync";
import {
  BOARD_ASSET_MAX_BYTES,
} from "@/lib/boards/assets/contracts";
import { acceptedBoardMediaMimeTypes } from "@/lib/boards/assets/media-rollout";
import type { RealtimeAwarenessState } from "@/lib/realtime/client/types";
import {
  CursorMotionController,
  cursorTransform,
  type CursorScreenPoint,
} from "@/lib/realtime/client/cursor-motion";
import { resolvePresencePresentation } from "@/lib/realtime/presence-identity";

const EMPTY_AWARENESS = new Map<number, RealtimeAwarenessState>();

type FabricWhiteboardSource =
  | Readonly<{
      kind: "store";
      store: TLStore | TLStoreWithStatus;
    }>
  | Readonly<{
      kind: "snapshot";
      snapshot?: TLEditorSnapshot | TLStoreSnapshot;
      persistenceKey?: string;
    }>;

/**
 * The shell owns tldraw UI, permissions, comments, sharing, export, and proposal review.
 * Persistence/realtime code owns the store and all translation between tldraw and Fabric documents.
 */
export type FabricWhiteboardDocumentAdapter = Readonly<{
  source: FabricWhiteboardSource;
  toCanvasDocument: (editor: Editor) => CanvasDocumentSnapshot;
  ai: FabricWhiteboardAiAdapter;
  onMount?: (editor: Editor) => void | (() => void | undefined);
}>;

export type FabricWhiteboardProps = Readonly<{
  boardId: string;
  workspaceId: string;
  boardTitle: string;
  boardOwnerId: string;
  boardProjectId: string;
  boardSharingPolicy: BoardSharingPolicy;
  archivedAt: string | null;
  role: WorkspaceRole;
  editingAuthorized: boolean;
  sharingAdministrationAuthorized: boolean;
  organizationEnabled: boolean;
  privateMediaEnabled: boolean;
  accessLost: boolean;
  documentGenerationId: string;
  durableSequence: number;
  documentAdapter: FabricWhiteboardDocumentAdapter;
  syncState: BoardSyncState;
  agentBoardReadiness: AgentBoardReadinessState;
  syncMessage?: string | null;
  onDocumentChange?: (snapshot: CanvasDocumentSnapshot) => void;
  onRetrySave: () => void;
  onReloadRemote: () => void;
  onDownloadLocalCopy: () => void;
  onOpenWorkspace: () => void;
  onCheckpointRestored: () => void | Promise<void>;
  onBoardAccessChanged: () => void | Promise<unknown>;
  onRefreshAgentCheckpoint: (
    snapshot: CanvasDocumentSnapshot,
  ) => Promise<{
    revision: number;
    documentGenerationId: string;
  } | null>;
  awarenessStates?: ReadonlyMap<number, RealtimeAwarenessState>;
  localAwarenessClientId?: number | null;
  onAwarenessChange?: (state: RealtimeAwarenessState | null) => void;
}>;

export function FabricWhiteboard({
  boardId,
  workspaceId,
  boardTitle,
  boardOwnerId,
  boardProjectId,
  boardSharingPolicy,
  archivedAt,
  role,
  editingAuthorized,
  sharingAdministrationAuthorized,
  organizationEnabled,
  privateMediaEnabled,
  accessLost,
  documentGenerationId,
  durableSequence,
  documentAdapter,
  syncState,
  agentBoardReadiness,
  syncMessage = null,
  onDocumentChange,
  onRetrySave,
  onReloadRemote,
  onDownloadLocalCopy,
  onOpenWorkspace,
  onCheckpointRestored,
  onBoardAccessChanged,
  onRefreshAgentCheckpoint,
  awarenessStates = EMPTY_AWARENESS,
  localAwarenessClientId = null,
  onAwarenessChange,
}: FabricWhiteboardProps) {
  const isArchived = archivedAt !== null;
  const canEdit =
    editingAuthorized &&
    !accessLost &&
    canEditBoardState({ role, archivedAt });
  const canComment =
    !accessLost && canCommentOnBoardState({ role, archivedAt });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [aiFinalizing, setAiFinalizing] = useState(false);
  const [panel, setPanel] = useState<"comments" | "ai" | "tools" | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [managementLost, setManagementLost] = useState(false);
  const [cameraVersion, setCameraVersion] = useState(0);
  const changeVersionRef = useRef(0);
  const localCursorRef = useRef<{ x: number; y: number } | null>(null);
  const presenceFrameRef = useRef<number | null>(null);
  const cameraFrameRef = useRef<number | null>(null);
  const hasRemoteCursor = hasRemotePresenceCursor(
    awarenessStates,
    localAwarenessClientId,
  );
  const hasRemoteCursorRef = useRef(hasRemoteCursor);
  const canManageSharing =
    sharingAdministrationAuthorized &&
    !managementLost &&
    !isArchived &&
    !accessLost &&
    role === "owner";
  const visiblePanel =
    accessLost || (!canEdit && (panel === "ai" || panel === "tools")) ? null : panel;
  const visibleShareOpen = canManageSharing && shareOpen;
  const acceptedMediaMimeTypes = acceptedBoardMediaMimeTypes(
    privateMediaEnabled,
  );

  const refreshAiCheckpoint = useCallback(async () => {
    if (!editor) return null;
    return onRefreshAgentCheckpoint(documentAdapter.toCanvasDocument(editor));
  }, [documentAdapter, editor, onRefreshAgentCheckpoint]);

  const handleOpenWorkspace = useCallback(() => {
    if (shouldOpenSyncRecoveryOnLeave(syncState)) {
      setRecoveryOpen(true);
      return;
    }
    onOpenWorkspace();
  }, [onOpenWorkspace, syncState]);

  useEffect(() => {
    hasRemoteCursorRef.current = hasRemoteCursor;
  }, [hasRemoteCursor]);

  useEffect(() => {
    if (!editor) return;
    editor.updateInstanceState({ isReadonly: !canEdit });
  }, [canEdit, editor]);

  const publishAwareness = useCallback(() => {
    if (!editor || !onAwarenessChange) return;
    const viewport = editor.getViewportPageBounds();
    onAwarenessChange({
      ...(localCursorRef.current ? { cursor: localCursorRef.current } : {}),
      viewport: {
        x: viewport.x,
        y: viewport.y,
        width: viewport.w,
        height: viewport.h,
      },
      selectionIds: editor.getSelectedShapeIds(),
    });
  }, [editor, onAwarenessChange]);

  const scheduleAwareness = useCallback(() => {
    if (!onAwarenessChange || presenceFrameRef.current !== null) return;
    presenceFrameRef.current = window.requestAnimationFrame(() => {
      presenceFrameRef.current = null;
      publishAwareness();
    });
  }, [onAwarenessChange, publishAwareness]);

  const scheduleCameraRefresh = useCallback(() => {
    if (!hasRemoteCursorRef.current || cameraFrameRef.current !== null) return;
    cameraFrameRef.current = window.requestAnimationFrame(() => {
      cameraFrameRef.current = null;
      setCameraVersion((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    if (!editor) return;
    scheduleAwareness();
    const dispose = editor.store.listen(
      () => {
        scheduleAwareness();
        scheduleCameraRefresh();
      },
      { scope: "session" },
    );
    return () => {
      dispose();
      if (presenceFrameRef.current !== null) {
        window.cancelAnimationFrame(presenceFrameRef.current);
        presenceFrameRef.current = null;
      }
      if (cameraFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraFrameRef.current);
        cameraFrameRef.current = null;
      }
      onAwarenessChange?.(null);
    };
  }, [editor, onAwarenessChange, scheduleAwareness, scheduleCameraRefresh]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!editor || !onAwarenessChange) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("button, input, textarea, select, dialog, aside")) return;
    const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
    localCursorRef.current = { x: point.x, y: point.y };
    scheduleAwareness();
  }, [editor, onAwarenessChange, scheduleAwareness]);

  const handlePointerLeave = useCallback(() => {
    if (!onAwarenessChange) return;
    localCursorRef.current = null;
    scheduleAwareness();
  }, [onAwarenessChange, scheduleAwareness]);

  const mountEditor = useCallback((nextEditor: Editor) => {
    setEditor(nextEditor);
    nextEditor.updateInstanceState({ isReadonly: !canEdit });
    const disposeAdapter = documentAdapter.onMount?.(nextEditor);
    const disposeChanges = nextEditor.store.listen(
      () => {
        changeVersionRef.current += 1;
        if (onDocumentChange) {
          onDocumentChange(documentAdapter.toCanvasDocument(nextEditor));
        }
      },
      { source: "user", scope: "document" },
    );

    return () => {
      disposeChanges();
      disposeAdapter?.();
      setEditor(null);
    };
  }, [canEdit, documentAdapter, onDocumentChange]);

  const getCommentAnchor = useCallback((): CommentAnchor => {
    if (!editor) return {};
    const selectedId = editor.getSelectedShapeIds()[0];
    if (selectedId) {
      const bounds = editor.getShapePageBounds(selectedId);
      return {
        nodeId: selectedId,
        ...(bounds ? { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 } : {}),
      };
    }
    const viewport = editor.getViewportPageBounds();
    return { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 };
  }, [editor]);

  const overlays = (
    <>
      <div className="pointer-events-none absolute inset-x-2 top-2 z-1000 flex items-start justify-between gap-2 sm:inset-x-3 sm:top-3">
        <div className="pointer-events-auto flex min-w-0 max-w-[calc(100%_-_6rem)] flex-col gap-2 sm:max-w-[calc(100%_-_14rem)] lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-2 rounded-radius-lg bg-surface-white p-1 floating-shadow">
            <IconButton label="Open Workspace" onClick={handleOpenWorkspace}>
              <ArrowLeftIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            </IconButton>
            <div className="hidden min-w-0 pr-2 sm:block">
              <h1 className="max-w-[24ch] truncate font-medium">{boardTitle}</h1>
              <p className="text-sm text-muted-gray">
                {accessLost
                  ? "Access unavailable - Recovery only"
                  : isArchived
                    ? `${roleLabel(role)} - Archived read-only`
                    : roleLabel(role)}
              </p>
            </div>
            {canEdit ? (
              <>
                <FabricAiTrigger
                  panelOpen={visiblePanel === "ai"}
                  busy={aiFinalizing}
                  disabled={!editor}
                  onClick={() => setPanel((current) => current === "ai" ? null : "ai")}
                />
                <FabricBoardThemePicker editor={editor} disabled={!editor} />
              </>
            ) : null}
          </div>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-1 rounded-radius-lg bg-surface-white p-1 floating-shadow">
          <PresenceSummary
            workspaceId={workspaceId}
            awarenessStates={awarenessStates}
            localAwarenessClientId={localAwarenessClientId}
          />
          <IconButton
            label="Open Comments"
            active={visiblePanel === "comments"}
            disabled={accessLost}
            onClick={() => setPanel((current) => current === "comments" ? null : "comments")}
          >
            <ChatBubbleLeftRightIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
          {canEdit ? (
            <IconButton
              label="Open Board Tools"
              active={visiblePanel === "tools"}
              disabled={!editor}
              aria-controls="fabric-board-tools-panel"
              aria-expanded={visiblePanel === "tools"}
              onClick={() => setPanel((current) => current === "tools" ? null : "tools")}
            >
              <RectangleStackIcon
                className="size-4 shrink-0 fill-current"
                aria-hidden="true"
              />
            </IconButton>
          ) : null}
          <IconButton label="Export Board" onClick={() => setExportOpen(true)}>
            <ArrowDownTrayIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
          <IconButton label="Board Checkpoints" onClick={() => setCheckpointsOpen(true)}>
            <BookmarkSquareIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          </IconButton>
          {canManageSharing ? (
            <IconButton label="Share Board" onClick={() => setShareOpen(true)}>
              <ShareIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>

      {isArchived && !accessLost ? (
        <p
          className="pointer-events-none absolute inset-x-3 top-16 z-999 mx-auto w-fit max-w-[calc(100%_-_1.5rem)] rounded-radius-pill bg-surface-white px-3 py-1.5 text-center text-sm text-muted-gray floating-shadow"
          role="status"
        >
          Archived board - Restore it from the Archived view to edit again.
        </p>
      ) : null}

      {accessLost ? (
        <p
          className="pointer-events-none absolute inset-x-3 top-16 z-999 mx-auto w-fit max-w-[calc(100%_-_1.5rem)] rounded-radius-pill bg-(--danger-soft) px-3 py-1.5 text-center text-sm text-(--danger) ring-1 ring-(--danger-border) floating-shadow"
          role="alert"
        >
          Board access changed. Editing is stopped, but your local recovery data was kept.
        </p>
      ) : null}

      <RemotePresenceCursors
        editor={editor}
        awarenessStates={awarenessStates}
        localAwarenessClientId={localAwarenessClientId}
        cameraVersion={cameraVersion}
      />

      <FabricCommentsPanel
        boardId={boardId}
        role={canComment ? role : "viewer"}
        open={visiblePanel === "comments"}
        getAnchor={getCommentAnchor}
        onClose={() => setPanel(null)}
      />

      {canEdit ? (
        <FabricAiPanel
          editor={editor}
          boardId={boardId}
          workspaceId={workspaceId}
          documentGenerationId={documentGenerationId}
          durableSequence={durableSequence}
          adapter={documentAdapter.ai}
          open={visiblePanel === "ai"}
          boardReadiness={agentBoardReadiness}
          readChangeVersion={() => changeVersionRef.current}
          onFinalizingChange={setAiFinalizing}
          onRetrySync={onRetrySave}
          onRefreshCheckpoint={refreshAiCheckpoint}
          onClose={() => setPanel(null)}
        />
      ) : null}

      <FabricBoardToolsPanel
        editor={editor}
        boardId={boardId}
        open={visiblePanel === "tools"}
        canEdit={canEdit}
        onOpen={() => setPanel("tools")}
        onClose={() => setPanel(null)}
      />

      <FabricShareDialog
        boardId={boardId}
        workspaceId={workspaceId}
        ownerId={boardOwnerId}
        projectId={boardProjectId}
        sharingPolicy={boardSharingPolicy}
        role={role}
      managementAuthorized={canManageSharing}
        organizationEnabled={organizationEnabled}
        open={visibleShareOpen}
        onClose={() => setShareOpen(false)}
        onBoardAccessChanged={onBoardAccessChanged}
        onManagementLost={() => setManagementLost(true)}
      />
      <FabricExportDialog
        editor={editor}
        boardTitle={boardTitle}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      <FabricCheckpointDialog
        boardId={boardId}
        canEdit={canEdit}
        isSynced={syncState === "synced"}
        open={checkpointsOpen}
        onClose={() => setCheckpointsOpen(false)}
        onRestored={onCheckpointRestored}
      />
      <RecoveryDialog
        state={syncState}
        message={syncMessage}
        open={recoveryOpen}
        onClose={() => setRecoveryOpen(false)}
        onRetrySave={onRetrySave}
        onReloadRemote={onReloadRemote}
        onDownloadLocalCopy={onDownloadLocalCopy}
        onLeaveBoard={() => {
          setRecoveryOpen(false);
          onOpenWorkspace();
        }}
      />
    </>
  );

  return (
    <main
      className="fabric-tldraw editor-shell isolate fixed inset-0 bg-surface-white font-sans text-near-black-primary-text antialiased"
      data-board-role={role}
      data-board-can-edit={canEdit ? "true" : "false"}
      data-fabric-panel={visiblePanel ?? "none"}
      onPointerMoveCapture={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {documentAdapter.source.kind === "store" ? (
        <Tldraw
          store={documentAdapter.source.store}
          components={fabricCanvasComponents}
          maxAssetSize={BOARD_ASSET_MAX_BYTES}
          acceptedImageMimeTypes={acceptedMediaMimeTypes.images}
          acceptedVideoMimeTypes={acceptedMediaMimeTypes.videos}
          autoFocus
          onMount={mountEditor}
        >
          {overlays}
        </Tldraw>
      ) : (
        <Tldraw
          snapshot={documentAdapter.source.snapshot}
          persistenceKey={documentAdapter.source.persistenceKey}
          components={fabricCanvasComponents}
          maxAssetSize={BOARD_ASSET_MAX_BYTES}
          acceptedImageMimeTypes={acceptedMediaMimeTypes.images}
          acceptedVideoMimeTypes={acceptedMediaMimeTypes.videos}
          autoFocus
          onMount={mountEditor}
        >
          {overlays}
        </Tldraw>
      )}
    </main>
  );
}

function hasRemotePresenceCursor(
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>,
  localAwarenessClientId: number | null,
): boolean {
  for (const [clientId, state] of awarenessStates) {
    if (clientId !== localAwarenessClientId && state.cursor) return true;
  }
  return false;
}

function RemotePresenceCursors({
  editor,
  awarenessStates,
  localAwarenessClientId,
  cameraVersion,
}: {
  editor: Editor | null;
  awarenessStates: ReadonlyMap<number, RealtimeAwarenessState>;
  localAwarenessClientId: number | null;
  cameraVersion: number;
}) {
  const [cursorMotion] = useState(
    () =>
      new CursorMotionController({
        requestFrame: (callback) => window.requestAnimationFrame(callback),
        cancelFrame: (handle) => window.cancelAnimationFrame(handle),
        now: () => performance.now(),
        prefersReducedMotion: () =>
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
      }),
  );

  useEffect(() => () => cursorMotion.destroy(), [cursorMotion]);

  if (!editor) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-800 overflow-hidden" aria-hidden="true">
      {remotePresenceEntries(awarenessStates, localAwarenessClientId).map(
        ([clientId, state]) => {
          if (!state.cursor) return null;
          const screen = editor.pageToScreen(state.cursor);
          const presence = resolvePresencePresentation(state);
          return (
            <RemotePresenceCursor
              key={clientId}
              clientId={clientId}
              target={screen}
              cameraVersion={cameraVersion}
              editorIdentity={editor}
              color={presence.color}
              label={presence.label}
              cursorMotion={cursorMotion}
            />
          );
        },
      )}
    </div>
  );
}

function RemotePresenceCursor({
  clientId,
  target,
  cameraVersion,
  editorIdentity,
  color,
  label,
  cursorMotion,
}: {
  clientId: number;
  target: CursorScreenPoint;
  cameraVersion: number;
  editorIdentity: Editor;
  color: string;
  label: string;
  cursorMotion: CursorMotionController;
}) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const initialTargetRef = useRef(target);
  const projectionRef = useRef({ cameraVersion, editorIdentity });

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    cursorMotion.attach(clientId, initialTargetRef.current, (position) => {
      element.style.transform = cursorTransform(position);
    });
    return () => cursorMotion.detach(clientId);
  }, [clientId, cursorMotion]);

  useLayoutEffect(() => {
    const projectionChanged =
      projectionRef.current.cameraVersion !== cameraVersion ||
      projectionRef.current.editorIdentity !== editorIdentity;
    projectionRef.current = { cameraVersion, editorIdentity };
    cursorMotion.setTarget(
      clientId,
      { x: target.x, y: target.y },
      { snap: projectionChanged },
    );
  }, [cameraVersion, clientId, cursorMotion, editorIdentity, target.x, target.y]);

  return (
    <div
      ref={elementRef}
      className="absolute left-0 top-0 will-change-transform"
      data-presence-client-id={clientId}
    >
      <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
        <path
          d="M2 1.5 16 11l-6.1 1.45L6.6 20 2 1.5Z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="absolute left-3 top-4 whitespace-nowrap rounded-radius-sm px-1.5 py-0.5 text-[0.6875rem] font-medium text-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {label}
      </span>
    </div>
  );
}

function RecoveryDialog({
  state,
  message,
  open,
  onClose,
  onRetrySave,
  onReloadRemote,
  onDownloadLocalCopy,
  onLeaveBoard,
}: {
  state: BoardSyncState;
  message: string | null;
  open: boolean;
  onClose: () => void;
  onRetrySave: () => void;
  onReloadRemote: () => void;
  onDownloadLocalCopy: () => void;
  onLeaveBoard: () => void;
}) {
  return (
    <FabricDialog
      open={open}
      title={boardSyncLabel(state)}
      description={message ?? "Choose how Fabric should protect your current board changes."}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-pretty text-base text-muted-gray sm:text-sm">
          Download a copy before reloading if the board contains changes that are not stored remotely.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            tone="primary"
            onClick={() => {
              onRetrySave();
              onClose();
            }}
            leading={<ArrowPathIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          >
            Retry Save
          </Button>
          <Button
            onClick={onDownloadLocalCopy}
            leading={<ArrowDownTrayIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          >
            Download Local Copy
          </Button>
          <Button
            tone="ghost"
            onClick={() => {
              onReloadRemote();
              onClose();
            }}
          >
            Reload Remote Board
          </Button>
          <Button tone="danger" onClick={onLeaveBoard}>
            Leave Board
          </Button>
        </div>
      </div>
    </FabricDialog>
  );
}

function roleLabel(role: WorkspaceRole): string {
  if (role === "owner") return "Owner";
  if (role === "editor") return "Editor";
  if (role === "commenter") return "Comment Access";
  return "View Only";
}
