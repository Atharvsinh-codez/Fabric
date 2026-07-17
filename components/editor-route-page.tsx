"use client";

import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/16/solid";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FabricWhiteboard } from "@/components/fabric-whiteboard";
import { useCurrentUser } from "@/components/current-user-provider";
import { Button, FabricLogo } from "@/components/ui";
import { APP_ROUTES } from "@/lib/app-routes";
import {
  collaborativeSyncMessage,
  collaborativeSyncState,
  resolveAgentBoardReadiness,
} from "@/lib/boards/collaborative-sync";
import {
  canEditBoardState,
  resolveBoardSessionAccess,
} from "@/lib/boards/board-state";
import { useFabricWhiteboardAdapter } from "@/lib/boards/use-fabric-whiteboard-adapter";
import {
  useBoardDocument,
} from "@/lib/boards/use-board-document";

type BoardPersistence = ReturnType<typeof useBoardDocument>;
type LoadedBoardPersistence = Omit<BoardPersistence, "board" | "canvas"> & {
  board: NonNullable<BoardPersistence["board"]>;
  canvas: NonNullable<BoardPersistence["canvas"]>;
};

export function EditorRoutePage({
  boardId,
  organizationEnabled,
  privateMediaEnabled,
}: {
  boardId: string;
  organizationEnabled: boolean;
  privateMediaEnabled: boolean;
}) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const persistence = useBoardDocument(boardId, currentUser.id);

  const openWorkspace = () => router.push(APP_ROUTES.dashboard);

  if (persistence.loadState === "loading") {
    return (
      <EditorRouteState busy title="Loading Board" description="Preparing the latest saved canvas.">
        <span className="spinner" aria-hidden="true" />
      </EditorRouteState>
    );
  }

  if (persistence.loadState === "not-found") {
    return (
      <EditorRouteState
        title="Board Not Found"
        description={persistence.loadError ?? "This board is no longer available."}
        icon={<ExclamationTriangleIcon className="size-4 shrink-0 fill-(--warning)" aria-hidden="true" />}
      >
        <Button
          tone="primary"
          leading={<ChevronLeftIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={openWorkspace}
        >
          Open Workspace
        </Button>
        <Button
          leading={<ArrowPathIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={() => void persistence.retryLoad()}
        >
          Retry Load
        </Button>
      </EditorRouteState>
    );
  }

  if (
    persistence.loadState === "error" ||
    !persistence.board ||
    !persistence.canvas
  ) {
    return (
      <EditorRouteState
        title="Board Could Not Load"
        description={
          persistence.loadError ??
          "Fabric could not open this board. Check your connection and try again."
        }
        icon={<ExclamationTriangleIcon className="size-4 shrink-0 fill-(--danger)" aria-hidden="true" />}
      >
        <Button
          tone="primary"
          leading={<ArrowPathIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={() => void persistence.retryLoad()}
        >
          Retry Load
        </Button>
        <Button
          leading={<ChevronLeftIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={openWorkspace}
        >
          Open Workspace
        </Button>
      </EditorRouteState>
    );
  }

  return (
    <LoadedFabricWhiteboard
      key={`${boardId}:${persistence.editorVersion}`}
      boardId={boardId}
      principalId={currentUser.id}
      organizationEnabled={organizationEnabled}
      privateMediaEnabled={privateMediaEnabled}
      persistence={persistence as LoadedBoardPersistence}
      onOpenWorkspace={openWorkspace}
    />
  );
}

function LoadedFabricWhiteboard({
  boardId,
  principalId,
  organizationEnabled,
  privateMediaEnabled,
  persistence,
  onOpenWorkspace,
}: {
  boardId: string;
  principalId: string;
  organizationEnabled: boolean;
  privateMediaEnabled: boolean;
  persistence: LoadedBoardPersistence;
  onOpenWorkspace: () => void;
}) {
  const archived = persistence.board.archivedAt !== null;
  const metadataCanEdit = canEditBoardState(persistence.board);
  const adapter = useFabricWhiteboardAdapter({
    principalId,
    boardId,
    documentGenerationId: persistence.board.documentGenerationId,
    documentKey: persistence.editorVersion,
    canEdit: metadataCanEdit,
    mediaUploadsEnabled: privateMediaEnabled,
    connectRealtime: !archived,
    initialCanvas: persistence.canvas,
    onCheckpoint: persistence.queueTldrawChange,
  });
  const realtimeAccessLost =
    adapter.realtime.connectionState === "permission-denied" ||
    Boolean(
      adapter.realtime.error?.permanent &&
      (adapter.realtime.error.code === "permission_denied" ||
        adapter.realtime.error.code === "authentication_failed"),
    );
  const realtimeLossEvidence = realtimeAccessLost
    ? (adapter.realtime.error ?? adapter.realtime.capabilities)
    : null;
  const [verifiedRealtimeLossEvidence, setVerifiedRealtimeLossEvidence] =
    useState<unknown>(null);
  const automaticRealtimeRetryUsedRef = useRef(false);
  const automaticAgentSyncRetryUsedRef = useRef(false);
  const refreshBoardAccess = persistence.refreshBoardAccess;
  const retryPersistenceSave = persistence.retrySave;
  const retryRealtimeConnection = adapter.realtime.retryConnection;
  const readOnlyCapabilityContradiction =
    metadataCanEdit &&
    adapter.realtime.capabilities.length > 0 &&
    !adapter.realtime.capabilities.includes("write");
  const agentBoardReadiness = resolveAgentBoardReadiness(
    persistence.syncState,
    adapter.realtime.connectionState,
    adapter.realtime.pendingAcknowledgements,
  );

  useEffect(() => {
    if (!realtimeLossEvidence) return;

    let current = true;
    void refreshBoardAccess().then((result) => {
      if (!current) return;
      // A failed metadata refresh is not an authorization decision, but it
      // should not leave the canvas in a permanent "rechecking" state either.
      setVerifiedRealtimeLossEvidence(realtimeLossEvidence);
      if (result === "refreshed" && !automaticRealtimeRetryUsedRef.current) {
        automaticRealtimeRetryUsedRef.current = true;
        retryRealtimeConnection();
      }
    });
    return () => {
      current = false;
    };
  }, [realtimeLossEvidence, refreshBoardAccess, retryRealtimeConnection]);

  useEffect(() => {
    if (adapter.realtime.connectionState !== "connected") return;
    automaticRealtimeRetryUsedRef.current = false;
  }, [adapter.realtime.connectionState]);

  useEffect(() => {
    if (!readOnlyCapabilityContradiction) return;
    void refreshBoardAccess();
  }, [readOnlyCapabilityContradiction, refreshBoardAccess]);

  useEffect(() => {
    if (
      agentBoardReadiness.state === "ready" ||
      adapter.realtime.connectionState !== "connected"
    ) {
      automaticAgentSyncRetryUsedRef.current = false;
      return;
    }
    if (
      archived ||
      !metadataCanEdit ||
      !agentBoardReadiness.shouldRetryPersistence ||
      automaticAgentSyncRetryUsedRef.current
    ) {
      return;
    }

    automaticAgentSyncRetryUsedRef.current = true;
    void retryPersistenceSave();
  }, [
    adapter.realtime.connectionState,
    agentBoardReadiness.shouldRetryPersistence,
    agentBoardReadiness.state,
    archived,
    metadataCanEdit,
    retryPersistenceSave,
  ]);

  const accessLost = persistence.accessRefreshState === "lost";
  const verifyingRealtimeAccess =
    realtimeLossEvidence !== null &&
    verifiedRealtimeLossEvidence !== realtimeLossEvidence &&
    !accessLost;
  const sessionAccess = resolveBoardSessionAccess({
    role: persistence.board.role,
    archivedAt: persistence.board.archivedAt,
    realtimeCapabilities: adapter.realtime.capabilities,
    realtimeWriteEnabled: adapter.realtime.writeEnabled,
    realtimeAccessLost: false,
    accessLost,
  });
  const syncState = archived
    ? "synced"
    : verifyingRealtimeAccess
      ? "saving"
    : collaborativeSyncState(
        persistence.syncState,
        adapter.realtime.connectionState,
        adapter.realtime.pendingAcknowledgements,
      );
  const syncMessage = archived
    ? "This board is archived and read-only. Restore it from Archived boards to edit again."
    : verifyingRealtimeAccess
      ? "Rechecking live collaboration. Your local changes remain safe on this device."
    : collaborativeSyncMessage({
        baseMessage: persistence.syncMessage,
        hydrationWarning: adapter.hydrationWarning,
        connectionState: adapter.realtime.connectionState,
        realtimeError: adapter.realtime.error?.message ?? null,
      });

  return (
    <FabricWhiteboard
      boardId={boardId}
      workspaceId={persistence.board.workspaceId}
      boardTitle={persistence.board.title}
      boardOwnerId={persistence.board.ownerId}
      boardProjectId={persistence.board.projectId}
      boardSharingPolicy={persistence.board.sharingPolicy}
      archivedAt={persistence.board.archivedAt}
      role={persistence.board.role}
      editingAuthorized={sessionAccess.canEdit}
      sharingAdministrationAuthorized={sessionAccess.canManageSharing}
      organizationEnabled={organizationEnabled}
      privateMediaEnabled={privateMediaEnabled}
      accessLost={accessLost}
      documentGenerationId={persistence.board.documentGenerationId}
      durableSequence={persistence.board.revision}
      documentAdapter={adapter.documentAdapter}
      syncState={syncState}
      agentBoardReadiness={agentBoardReadiness.state}
      syncMessage={syncMessage}
      onRetrySave={() => {
        retryRealtimeConnection();
        void persistence.retrySave();
      }}
      onReloadRemote={() => void persistence.reloadRemote()}
      onDownloadLocalCopy={persistence.downloadLocalCopy}
      onOpenWorkspace={onOpenWorkspace}
      onCheckpointRestored={() => persistence.reloadRemote()}
      onBoardAccessChanged={refreshBoardAccess}
      awarenessStates={adapter.realtime.awareness}
      localAwarenessClientId={adapter.realtime.localAwarenessClientId}
      onAwarenessChange={adapter.realtime.setAwarenessState}
    />
  );
}

function EditorRouteState({
  title,
  description,
  icon,
  busy = false,
  children,
}: {
  title: string;
  description: string;
  icon?: React.ReactNode;
  busy?: boolean;
  children: React.ReactNode;
}) {
  return (
    <main
      className="editor-shell isolate flex flex-col bg-surface-white text-near-black-primary-text"
      aria-busy={busy}
    >
      <header className="flex h-12 shrink-0 items-center border-b border-border-subtle px-3">
        <FabricLogo />
      </header>
      <section className="grid min-h-0 flex-1 place-items-center bg-light-surface-tint px-5 py-12">
        <div className="flex max-w-md flex-col items-center gap-5 text-center" role="status" aria-live="polite">
          {icon}
          <div className="flex flex-col gap-2">
            <h1 className="text-balance text-xl font-medium">{title}</h1>
            <p className="text-pretty text-base text-dark-text-alt/70 sm:text-sm">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">{children}</div>
        </div>
      </section>
    </main>
  );
}
