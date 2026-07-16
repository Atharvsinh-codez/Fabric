"use client";

import { useCallback, useEffect, useState } from "react";

import type { ShareLinkPermission } from "@/db/schema/product";
import {
  createBoardShareLink,
  FabricApiError,
  listBoardShareLinks,
  revokeBoardShareLink,
  type BoardShareLink,
} from "@/lib/boards/client";

function errorMessage(error: unknown): string {
  return error instanceof FabricApiError
    ? error.message
    : "Share links could not be updated. Check your connection and try again.";
}

export function useBoardShareLinks(boardId: string, enabled: boolean) {
  const [links, setLinks] = useState<BoardShareLink[]>([]);
  const [loadedBoardId, setLoadedBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return [];
    const nextLinks = await listBoardShareLinks(boardId, signal);
    setLinks(nextLinks);
    setLoadedBoardId(boardId);
    setError(null);
    return nextLinks;
  }, [boardId, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void listBoardShareLinks(boardId, controller.signal)
      .then((nextLinks) => {
        if (!controller.signal.aborted) {
          setLinks(nextLinks);
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

  const createLink = useCallback(async (
    permission: ShareLinkPermission,
    expiresAt: string | null,
  ) => {
    setCreating(true);
    setError(null);
    try {
      const created = await createBoardShareLink({ boardId, permission, expiresAt });
      await refresh();
      return created;
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      setCreating(false);
    }
  }, [boardId, refresh]);

  const revokeLink = useCallback(async (linkId: string) => {
    setRevokingId(linkId);
    setError(null);
    try {
      await revokeBoardShareLink({ boardId, linkId });
      await refresh();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      throw caught instanceof Error ? caught : new Error(message);
    } finally {
      setRevokingId(null);
    }
  }, [boardId, refresh]);

  return {
    links: enabled && loadedBoardId === boardId ? links : [],
    loading: enabled && (loading || loadedBoardId !== boardId),
    creating,
    revokingId,
    error: enabled && loadedBoardId === boardId ? error : null,
    createLink,
    revokeLink,
  } as const;
}
