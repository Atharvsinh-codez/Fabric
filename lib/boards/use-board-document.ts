"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardDocument } from "@/db/schema/product";
import {
  FabricApiError,
  getBoard,
  updateBoardDocument,
  type BoardDetail,
} from "@/lib/boards/client";
import {
  documentFingerprint,
  readCanvasDocument,
  writeCanvasDocument,
  type CanvasDocumentSnapshot,
} from "@/lib/boards/canvas-document";
import {
  canEditBoardState,
  mergeBoardMetadataPreservingLocalDocument,
} from "@/lib/boards/board-state";
import type { FabricTldrawDocument } from "@/lib/boards/tldraw-document";

const SAVE_DEBOUNCE_MS = 800;
const DRAFT_STORAGE_VERSION = 1;

export type BoardSyncState =
  | "synced"
  | "saving"
  | "offline"
  | "conflict"
  | "error";

export type BoardLoadState = "loading" | "ready" | "not-found" | "error";
export type BoardAccessRefreshState = "current" | "refreshing" | "lost";
export type BoardAccessRefreshResult = "refreshed" | "lost" | "unavailable";

type StoredBoardDraft = Readonly<{
  version: typeof DRAFT_STORAGE_VERSION;
  principalId: string;
  boardId: string;
  expectedRevision: number;
  expectedDocumentGenerationId: string;
  workspaceId: string;
  boardTitle: string;
  role: BoardDetail["role"];
  document: BoardDocument;
  updatedAt: string;
}>;

function draftStorageKey(principalId: string, boardId: string): string {
  return `fabric:board-draft:${principalId}:${boardId}`;
}

function legacyDraftStorageKey(boardId: string): string {
  return `fabric:board-draft:${boardId}`;
}

function removeLegacyStoredDraft(boardId: string): void {
  try {
    window.localStorage.removeItem(legacyDraftStorageKey(boardId));
  } catch {
    // Account isolation still relies on the scoped key when storage is unavailable.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStoredDraft(principalId: string, boardId: string): StoredBoardDraft | null {
  try {
    removeLegacyStoredDraft(boardId);
    const key = draftStorageKey(principalId, boardId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value) ||
      value.version !== DRAFT_STORAGE_VERSION ||
      value.principalId !== principalId ||
      value.boardId !== boardId ||
      typeof value.expectedRevision !== "number" ||
      !Number.isSafeInteger(value.expectedRevision) ||
      value.expectedRevision < 0 ||
      typeof value.expectedDocumentGenerationId !== "string" ||
      typeof value.workspaceId !== "string" ||
      typeof value.boardTitle !== "string" ||
      !["owner", "editor", "commenter", "viewer"].includes(String(value.role)) ||
      !isRecord(value.document) ||
      typeof value.updatedAt !== "string"
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    return value as StoredBoardDraft;
  } catch {
    return null;
  }
}

function removeStoredDraft(principalId: string, boardId: string): void {
  try {
    removeLegacyStoredDraft(boardId);
    window.localStorage.removeItem(draftStorageKey(principalId, boardId));
  } catch {
    // Storage can be unavailable in privacy modes. The in-memory draft remains intact.
  }
}

function storeDraft(
  principalId: string,
  board: BoardDetail,
  document: BoardDocument,
): boolean {
  const draft: StoredBoardDraft = {
    version: DRAFT_STORAGE_VERSION,
    principalId,
    boardId: board.id,
    expectedRevision: board.revision,
    expectedDocumentGenerationId: board.documentGenerationId,
    workspaceId: board.workspaceId,
    boardTitle: board.title,
    role: board.role,
    document,
    updatedAt: new Date().toISOString(),
  };

  try {
    removeLegacyStoredDraft(board.id);
    window.localStorage.setItem(
      draftStorageKey(principalId, board.id),
      JSON.stringify(draft),
    );
    return true;
  } catch {
    // Autosave still retains the draft in memory and reports any upload problem.
    return false;
  }
}

function offlineDraftMessage(storedOnDevice: boolean): string {
  return storedOnDevice
    ? "Your draft is kept on this device and will retry when you reconnect."
    : "Your draft is kept in this tab. Download a local copy before closing it.";
}

function isNetworkFailure(error: unknown): boolean {
  return (
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    error instanceof TypeError
  );
}

function editBlockedMessage(board: BoardDetail): string {
  return board.archivedAt
    ? "This board is archived. Restore it before uploading local changes."
    : "Your current board role cannot upload this local draft.";
}

export function useBoardDocument(boardId: string, principalId: string) {
  const [loadState, setLoadState] = useState<BoardLoadState>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [canvas, setCanvas] = useState<CanvasDocumentSnapshot | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [syncState, setSyncState] = useState<BoardSyncState>("synced");
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [accessRefreshState, setAccessRefreshState] =
    useState<BoardAccessRefreshState>("current");

  const boardRef = useRef<BoardDetail | null>(null);
  const baseDocumentRef = useRef<BoardDocument | null>(null);
  const localDocumentRef = useRef<BoardDocument | null>(null);
  const localFingerprintRef = useRef("");
  const lastSavedFingerprintRef = useRef("");
  const pendingRef = useRef(false);
  const conflictRef = useRef(false);
  const savingRef = useRef(false);
  const draftStoredRef = useRef(true);
  const saveTimerRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);
  const accessLostRef = useRef(false);
  const accessRefreshPromiseRef =
    useRef<Promise<BoardAccessRefreshResult> | null>(null);
  const flushPendingRef = useRef<() => Promise<void>>(async () => undefined);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const scheduleFlush = useCallback(
    (delay = SAVE_DEBOUNCE_MS) => {
      clearSaveTimer();
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushPendingRef.current();
      }, delay);
    },
    [clearSaveTimer],
  );

  const flushPending = useCallback(async () => {
    if (savingRef.current || conflictRef.current || !pendingRef.current) return;
    const currentBoard = boardRef.current;
    const document = localDocumentRef.current;
    if (!currentBoard || !document) return;
    if (accessLostRef.current || !canEditBoardState(currentBoard)) {
      setSyncState("error");
      setSyncMessage(
        accessLostRef.current
          ? "Board access is no longer available. Your local recovery data has been retained."
          : editBlockedMessage(currentBoard),
      );
      return;
    }

    if (!navigator.onLine) {
      setSyncState("offline");
      setSyncMessage(offlineDraftMessage(draftStoredRef.current));
      return;
    }

    const savingFingerprint = localFingerprintRef.current;
    let shouldFlushAgain = false;
    savingRef.current = true;
    setSyncState("saving");
    setSyncMessage(null);

    try {
      const saved = await updateBoardDocument({
        boardId: currentBoard.id,
        expectedRevision: currentBoard.revision,
        expectedDocumentGenerationId: currentBoard.documentGenerationId,
        document,
      });
      const nextBoard: BoardDetail = {
        ...(boardRef.current ?? currentBoard),
        ...saved,
        document:
          localFingerprintRef.current === savingFingerprint
            ? saved.document
            : (localDocumentRef.current ?? saved.document),
      };

      boardRef.current = nextBoard;
      baseDocumentRef.current = saved.document;
      lastSavedFingerprintRef.current = savingFingerprint;
      setBoard(nextBoard);

      if (localFingerprintRef.current === savingFingerprint) {
        pendingRef.current = false;
        removeStoredDraft(principalId, currentBoard.id);
        setSyncState("synced");
        setSyncMessage(null);
      } else {
        pendingRef.current = true;
        if (localDocumentRef.current) {
          draftStoredRef.current = storeDraft(
            principalId,
            nextBoard,
            localDocumentRef.current,
          );
        }
        setSyncState("saving");
        shouldFlushAgain = true;
      }
    } catch (error) {
      if (error instanceof FabricApiError && error.code === "revision_conflict") {
        conflictRef.current = true;
        setSyncState("conflict");
        setSyncMessage(
          draftStoredRef.current
            ? "This board changed elsewhere. Your local draft has not overwritten the remote board."
            : "This board changed elsewhere. Your draft is kept in this tab, so download a copy before closing it.",
        );
      } else if (isNetworkFailure(error)) {
        setSyncState("offline");
        setSyncMessage(offlineDraftMessage(draftStoredRef.current));
      } else {
        setSyncState("error");
        setSyncMessage(
          error instanceof FabricApiError
            ? `${error.message} Retry the save or download your local copy.`
            : "Fabric could not save this board. Retry the save or download your local copy.",
        );
      }
    } finally {
      savingRef.current = false;
      if (shouldFlushAgain && pendingRef.current && !conflictRef.current && navigator.onLine) {
        scheduleFlush(250);
      }
    }
  }, [principalId, scheduleFlush]);

  useEffect(() => {
    flushPendingRef.current = flushPending;
  }, [flushPending]);

  const loadBoard = useCallback(
    async (options: { discardDraft?: boolean } = {}) => {
      const sequence = ++loadSequenceRef.current;
      clearSaveTimer();
      savingRef.current = false;
      pendingRef.current = false;
      conflictRef.current = false;
      draftStoredRef.current = true;
      setLoadState("loading");
      setLoadError(null);
      setSyncMessage(null);

      if (options.discardDraft) removeStoredDraft(principalId, boardId);

      try {
        const remoteBoard = await getBoard(boardId);
        if (loadSequenceRef.current !== sequence) return;

        accessLostRef.current = false;
        setAccessRefreshState("current");

        const remoteFingerprint = documentFingerprint(remoteBoard.document);
        const draft = options.discardDraft
          ? null
          : readStoredDraft(principalId, boardId);
        let effectiveDocument = remoteBoard.document;
        let nextSyncState: BoardSyncState = navigator.onLine ? "synced" : "offline";

        baseDocumentRef.current = remoteBoard.document;
        lastSavedFingerprintRef.current = remoteFingerprint;
        boardRef.current = remoteBoard;

        if (draft) {
          draftStoredRef.current = true;
          const draftFingerprint = documentFingerprint(draft.document);
          if (draftFingerprint === remoteFingerprint) {
            removeStoredDraft(principalId, boardId);
          } else {
            effectiveDocument = draft.document;
            localDocumentRef.current = draft.document;
            localFingerprintRef.current = draftFingerprint;
            pendingRef.current = true;

            const draftMatchesRemoteBase =
              draft.expectedRevision === remoteBoard.revision &&
              draft.expectedDocumentGenerationId === remoteBoard.documentGenerationId;
            if (!canEditBoardState(remoteBoard)) {
              conflictRef.current = true;
              nextSyncState = "conflict";
              setSyncMessage(
                remoteBoard.archivedAt
                  ? "This board was archived. Your local draft has not been uploaded. Download it or restore the board before retrying."
                  : "Your board role changed. This local draft has not been uploaded. Download it or reload the remote board.",
              );
            } else if (draftMatchesRemoteBase) {
              nextSyncState = navigator.onLine ? "saving" : "offline";
            } else {
              conflictRef.current = true;
              nextSyncState = "conflict";
              setSyncMessage(
                "A local draft and the remote board both changed. Copy your draft or reload the remote board.",
              );
            }
          }
        }

        if (!draft || documentFingerprint(effectiveDocument) === remoteFingerprint) {
          localDocumentRef.current = effectiveDocument;
          localFingerprintRef.current = documentFingerprint(effectiveDocument);
        }

        const effectiveBoard = { ...remoteBoard, document: effectiveDocument };
        boardRef.current = effectiveBoard;
        setBoard(effectiveBoard);
        setCanvas(readCanvasDocument(effectiveDocument));
        setEditorVersion((current) => current + 1);
        setSyncState(nextSyncState);
        setLoadState("ready");

        if (pendingRef.current && !conflictRef.current && navigator.onLine) {
          scheduleFlush(250);
        } else if (nextSyncState === "offline") {
          setSyncMessage(offlineDraftMessage(draftStoredRef.current));
        }
      } catch (error) {
        if (loadSequenceRef.current !== sequence) return;
        const offlineDraft = isNetworkFailure(error)
          ? readStoredDraft(principalId, boardId)
          : null;
        if (offlineDraft) {
          const offlineBoard: BoardDetail = {
            id: boardId,
            workspaceId: offlineDraft.workspaceId,
            projectId: "offline",
            projectName: null,
            ownerId: principalId,
            title: offlineDraft.boardTitle,
            cover: null,
            status: "active",
            sharingPolicy: "workspace",
            role: offlineDraft.role,
            favorite: false,
            pinned: false,
            lastOpenedAt: offlineDraft.updatedAt,
            document: offlineDraft.document,
            revision: offlineDraft.expectedRevision,
            documentGenerationId: offlineDraft.expectedDocumentGenerationId,
            archivedAt: null,
            createdAt: offlineDraft.updatedAt,
            updatedAt: offlineDraft.updatedAt,
          };
          boardRef.current = offlineBoard;
          baseDocumentRef.current = offlineDraft.document;
          localDocumentRef.current = offlineDraft.document;
          localFingerprintRef.current = documentFingerprint(offlineDraft.document);
          lastSavedFingerprintRef.current = "";
          pendingRef.current = true;
          conflictRef.current = false;
          draftStoredRef.current = true;
          setBoard(offlineBoard);
          setCanvas(readCanvasDocument(offlineDraft.document));
          setEditorVersion((current) => current + 1);
          setSyncState("offline");
          setSyncMessage(offlineDraftMessage(true));
          setLoadState("ready");
          return;
        }
        setBoard(null);
        setCanvas(null);
        if (error instanceof FabricApiError && error.status === 404) {
          accessLostRef.current = true;
          setAccessRefreshState("lost");
          setLoadState("not-found");
          setLoadError("The requested board was not found or is no longer available.");
        } else {
          setLoadState("error");
          setLoadError(
            error instanceof FabricApiError
              ? error.message
              : "Fabric could not load this board. Check your connection and try again.",
          );
        }
      }
    },
    [boardId, clearSaveTimer, principalId, scheduleFlush],
  );

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void loadBoard();
    }, 0);
    return () => {
      window.clearTimeout(loadTimer);
      loadSequenceRef.current += 1;
      clearSaveTimer();
    };
  }, [clearSaveTimer, loadBoard]);

  useEffect(() => {
    const handleOnline = () => {
      if (conflictRef.current) return;
      if (pendingRef.current && !conflictRef.current) {
        setSyncState("saving");
        setSyncMessage(null);
        scheduleFlush(100);
      } else {
        setSyncState("synced");
        setSyncMessage(null);
      }
    };
    const handleOffline = () => {
      if (conflictRef.current) return;
      if (pendingRef.current) {
        setSyncState("offline");
        setSyncMessage(offlineDraftMessage(draftStoredRef.current));
      } else {
        setSyncState("offline");
        setSyncMessage("You are offline. New changes will stay on this device until you reconnect.");
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [scheduleFlush]);

  useEffect(() => {
    const protectUnsavedMemoryDraft = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current || draftStoredRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedMemoryDraft);
    return () => window.removeEventListener("beforeunload", protectUnsavedMemoryDraft);
  }, []);

  const queueCanvasChange = useCallback(
    (snapshot: CanvasDocumentSnapshot) => {
      const currentBoard = boardRef.current;
      const currentDocument = localDocumentRef.current ?? baseDocumentRef.current;
      if (!currentBoard || !currentDocument) return;
      if (accessLostRef.current || !canEditBoardState(currentBoard)) return;

      const document = writeCanvasDocument(currentDocument, snapshot);
      const fingerprint = documentFingerprint(document);
      localDocumentRef.current = document;
      localFingerprintRef.current = fingerprint;

      if (fingerprint === lastSavedFingerprintRef.current) {
        pendingRef.current = false;
        removeStoredDraft(principalId, currentBoard.id);
        if (!conflictRef.current) {
          setSyncState("synced");
          setSyncMessage(null);
        }
        return;
      }

      pendingRef.current = true;
      draftStoredRef.current = storeDraft(principalId, currentBoard, document);
      if (conflictRef.current) {
        setSyncState("conflict");
        if (!draftStoredRef.current) {
          setSyncMessage(
            "This board changed elsewhere. Your draft is kept in this tab, so download a copy before closing it.",
          );
        }
        return;
      }
      if (!navigator.onLine) {
        setSyncState("offline");
        setSyncMessage(offlineDraftMessage(draftStoredRef.current));
        return;
      }

      setSyncState("saving");
      setSyncMessage(null);
      scheduleFlush();
    },
    [principalId, scheduleFlush],
  );

  const queueTldrawChange = useCallback(
    (
      snapshot: CanvasDocumentSnapshot & {
        tldraw: FabricTldrawDocument;
      },
    ) => {
      // The tldraw checkpoint and semantic AI/share projection are committed as
      // one optimistic HTTP recovery document. Realtime ACK state remains
      // separate in useTldrawCollaboration.
      setCanvas(snapshot);
      queueCanvasChange(snapshot);
    },
    [queueCanvasChange],
  );

  const retrySave = useCallback(async () => {
    if (!pendingRef.current) {
      setSyncState("synced");
      setSyncMessage(null);
      return;
    }

    if (!conflictRef.current) {
      if (!navigator.onLine) {
        setSyncState("offline");
        setSyncMessage(offlineDraftMessage(draftStoredRef.current));
      } else {
        setSyncState("saving");
        setSyncMessage(null);
      }
      scheduleFlush(0);
      return;
    }

    const localDocument = localDocumentRef.current;
    const previousBaseFingerprint = lastSavedFingerprintRef.current;
    if (!localDocument) return;

    setSyncState("saving");
    setSyncMessage("Checking the remote board before retrying your draft.");
    try {
      const remoteBoard = await getBoard(boardId);
      const remoteFingerprint = documentFingerprint(remoteBoard.document);
      const localFingerprint = documentFingerprint(localDocument);

      if (!canEditBoardState(remoteBoard)) {
        setSyncState("conflict");
        setSyncMessage(
          remoteBoard.archivedAt
            ? "This board is archived. Download this draft or restore the board before retrying."
            : "Your current board role cannot upload this draft. Download it or reload the remote board.",
        );
        return;
      }

      if (remoteFingerprint === localFingerprint) {
        boardRef.current = remoteBoard;
        baseDocumentRef.current = remoteBoard.document;
        lastSavedFingerprintRef.current = remoteFingerprint;
        pendingRef.current = false;
        conflictRef.current = false;
        removeStoredDraft(principalId, boardId);
        setBoard(remoteBoard);
        setSyncState("synced");
        setSyncMessage(null);
        return;
      }

      if (remoteFingerprint === previousBaseFingerprint) {
        if (
          remoteBoard.documentGenerationId !==
          boardRef.current?.documentGenerationId
        ) {
          setSyncState("conflict");
          setSyncMessage(
            "The remote board was replaced with a new document generation. Copy your draft or reload the remote board.",
          );
          return;
        }
        const effectiveBoard = { ...remoteBoard, document: localDocument };
        boardRef.current = effectiveBoard;
        baseDocumentRef.current = remoteBoard.document;
        conflictRef.current = false;
        draftStoredRef.current = storeDraft(
          principalId,
          effectiveBoard,
          localDocument,
        );
        setBoard(effectiveBoard);
        setSyncState("saving");
        setSyncMessage(null);
        scheduleFlush(0);
        return;
      }

      setSyncState("conflict");
      setSyncMessage(
        "The remote board still contains different changes. Copy your draft or reload the remote board.",
      );
    } catch (error) {
      setSyncState("conflict");
      setSyncMessage(
        isNetworkFailure(error)
          ? draftStoredRef.current
            ? "Fabric could not check the remote board. Your local draft remains on this device."
            : "Fabric could not check the remote board. Download your in-tab draft before closing it."
          : "Fabric could not verify a safe retry. Copy your draft or reload the remote board.",
      );
    }
  }, [boardId, principalId, scheduleFlush]);

  const refreshBoardAccess = useCallback((): Promise<BoardAccessRefreshResult> => {
    const existing = accessRefreshPromiseRef.current;
    if (existing) return existing;

    const refresh = (async (): Promise<BoardAccessRefreshResult> => {
      setAccessRefreshState("refreshing");
      try {
        const remoteBoard = await getBoard(boardId);
        const currentBoard = boardRef.current;
        if (!currentBoard) {
          setAccessRefreshState("current");
          return "unavailable";
        }

        const nextBoard = mergeBoardMetadataPreservingLocalDocument(
          currentBoard,
          remoteBoard,
        );
        accessLostRef.current = false;
        boardRef.current = nextBoard;
        setBoard(nextBoard);
        setAccessRefreshState("current");

        if (!canEditBoardState(nextBoard) && pendingRef.current) {
          clearSaveTimer();
          conflictRef.current = true;
          setSyncState("conflict");
          setSyncMessage(
            nextBoard.archivedAt
              ? "This board was archived. Your local draft and realtime recovery data remain on this device."
              : "Your board access changed. Your local draft and realtime recovery data were retained without uploading.",
          );
        }
        return "refreshed";
      } catch (error) {
        if (error instanceof FabricApiError && error.status === 404) {
          accessLostRef.current = true;
          clearSaveTimer();
          if (pendingRef.current) conflictRef.current = true;
          setAccessRefreshState("lost");
          setSyncState(pendingRef.current ? "conflict" : "error");
          setSyncMessage(
            "Board access is no longer available. Your local draft and realtime recovery data remain on this device for recovery.",
          );
          return "lost";
        }

        // A failed metadata refresh is not an authorization decision. Keep the
        // current offline editing/outbox behavior until the server explicitly
        // denies access or returns a resolved read-only capability set.
        setAccessRefreshState((current) =>
          current === "lost" ? "lost" : "current",
        );
        return "unavailable";
      }
    })();

    accessRefreshPromiseRef.current = refresh;
    void refresh.finally(() => {
      if (accessRefreshPromiseRef.current === refresh) {
        accessRefreshPromiseRef.current = null;
      }
    });
    return refresh;
  }, [boardId, clearSaveTimer]);

  const reloadRemote = useCallback(async () => {
    await loadBoard({ discardDraft: true });
  }, [loadBoard]);

  const downloadLocalCopy = useCallback(() => {
    const document = localDocumentRef.current;
    if (!document) return;
    const title = boardRef.current?.title ?? "fabric-board";
    const safeTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "fabric-board";
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], { type: "application/json" }),
    );
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${safeTitle}-local-draft.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  return {
    loadState,
    loadError,
    board,
    canvas,
    tldraw: canvas?.tldraw ?? null,
    editorVersion,
    syncState,
    syncMessage,
    accessRefreshState,
    queueCanvasChange,
    queueTldrawChange,
    retryLoad: loadBoard,
    retrySave,
    refreshBoardAccess,
    reloadRemote,
    downloadLocalCopy,
  } as const;
}
