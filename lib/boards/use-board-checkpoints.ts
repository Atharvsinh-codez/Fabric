"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createBoardCheckpoint,
  FabricApiError,
  listBoardCheckpoints,
  restoreBoardCheckpoint,
  type BoardCheckpoint,
  type RestoredBoardCheckpoint,
} from "@/lib/boards/client";

function checkpointErrorMessage(error: unknown): string {
  return error instanceof FabricApiError
    ? error.message
    : "Checkpoints could not be updated. Check your connection and try again.";
}

export function useBoardCheckpoints(boardId: string, enabled = true) {
  const [checkpoints, setCheckpoints] = useState<BoardCheckpoint[]>([]);
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return [];
    const nextCheckpoints = await listBoardCheckpoints(boardId, signal);
    setCheckpoints(nextCheckpoints);
    setLoadedBoardId(boardId);
    setError(null);
    return nextCheckpoints;
  }, [boardId, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const controller = new AbortController();
    void listBoardCheckpoints(boardId, controller.signal)
      .then((nextCheckpoints) => {
        if (!controller.signal.aborted) {
          setCheckpoints(nextCheckpoints);
          setLoadedBoardId(boardId);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setLoadedBoardId(boardId);
          setError(checkpointErrorMessage(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [boardId, enabled]);

  const createCheckpoint = useCallback(async (name: string): Promise<BoardCheckpoint> => {
    setCreating(true);
    setError(null);
    try {
      const created = await createBoardCheckpoint({ boardId, name });
      setLoadedBoardId(boardId);
      setCheckpoints((current) => [
        created,
        ...current.filter((checkpoint) => checkpoint.id !== created.id),
      ]);
      return created;
    } catch (caught) {
      const message = checkpointErrorMessage(caught);
      setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      setCreating(false);
    }
  }, [boardId]);

  const restoreCheckpoint = useCallback(async (
    checkpointId: string,
  ): Promise<RestoredBoardCheckpoint> => {
    setRestoringId(checkpointId);
    setError(null);
    try {
      return await restoreBoardCheckpoint({ boardId, checkpointId });
    } catch (caught) {
      const message = checkpointErrorMessage(caught);
      setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      setRestoringId(null);
    }
  }, [boardId]);

  const retry = useCallback(async () => {
    setLoading(true);
    try {
      await refresh();
    } catch (caught) {
      setError(checkpointErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  const clearError = useCallback(() => setError(null), []);

  return {
    checkpoints: enabled && loadedBoardId === boardId ? checkpoints : [],
    loading: enabled && (loading || loadedBoardId !== boardId),
    creating,
    restoringId,
    error: enabled && loadedBoardId === boardId ? error : null,
    createCheckpoint,
    restoreCheckpoint,
    retry,
    clearError,
  } as const;
}
