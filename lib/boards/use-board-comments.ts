"use client";

import { useCallback, useEffect, useState } from "react";

import type { CommentAnchor } from "@/db/schema/product";
import {
  createBoardCommentThread,
  FabricApiError,
  listBoardCommentThreads,
  replyToBoardCommentThread,
  setBoardCommentThreadResolution,
  type BoardCommentThread,
} from "@/lib/boards/client";

type CommentMutation = "create" | "reply" | "resolve" | null;

function errorMessage(error: unknown): string {
  return error instanceof FabricApiError
    ? error.message
    : "Comments could not be updated. Check your connection and try again.";
}

export function useBoardComments(boardId: string, enabled = true) {
  const [threads, setThreads] = useState<BoardCommentThread[]>([]);
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [mutation, setMutation] = useState<CommentMutation>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return [];
    const nextThreads = await listBoardCommentThreads(boardId, signal);
    setThreads(nextThreads);
    setLoadedBoardId(boardId);
    setError(null);
    return nextThreads;
  }, [boardId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void listBoardCommentThreads(boardId, controller.signal)
      .then((nextThreads) => {
        if (!controller.signal.aborted) {
          setThreads(nextThreads);
          setLoadedBoardId(boardId);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setLoadedBoardId(boardId);
          setError(errorMessage(caught));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [boardId, enabled]);

  const runMutation = useCallback(async (
    kind: Exclude<CommentMutation, null>,
    operation: () => Promise<void>,
  ) => {
    setMutation(kind);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      setMutation(null);
    }
  }, [refresh]);

  const createThread = useCallback((anchor: CommentAnchor, body: string) =>
    runMutation("create", () => createBoardCommentThread({ boardId, anchor, body })),
  [boardId, runMutation]);

  const reply = useCallback((threadId: string, body: string) =>
    runMutation("reply", () => replyToBoardCommentThread({ boardId, threadId, body })),
  [boardId, runMutation]);

  const setResolved = useCallback((threadId: string, resolved: boolean) =>
    runMutation("resolve", () =>
      setBoardCommentThreadResolution({ boardId, threadId, resolved })),
  [boardId, runMutation]);

  const retry = useCallback(async () => {
    setLoading(true);
    try {
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [refresh]);

  return {
    threads: enabled && loadedBoardId === boardId ? threads : [],
    loading: enabled && (loading || loadedBoardId !== boardId),
    mutation,
    error: enabled && loadedBoardId === boardId ? error : null,
    createThread,
    reply,
    setResolved,
    retry,
  } as const;
}
