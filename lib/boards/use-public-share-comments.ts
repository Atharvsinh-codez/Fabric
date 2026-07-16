"use client";

import { useCallback, useEffect, useState } from "react";

import type { ShareLinkPermission, CommentAnchor } from "@/db/schema/product";
import {
  createPublicShareCommentThread,
  FabricApiError,
  listPublicShareCommentThreads,
  replyToPublicShareCommentThread,
  type BoardCommentThread,
} from "@/lib/boards/client";

type PublicShareCommentMutation = "create" | "reply" | null;

function publicCommentError(error: unknown): {
  message: string;
  signInRequired: boolean;
  unavailable: boolean;
} {
  if (error instanceof FabricApiError) {
    if (error.status === 401) {
      return {
        message: "Sign in to add or reply to comments.",
        signInRequired: true,
        unavailable: false,
      };
    }
    if (error.status === 404) {
      return {
        message: "This share link is no longer available.",
        signInRequired: false,
        unavailable: true,
      };
    }
    if (error.code === "thread_resolved") {
      return {
        message: "This comment thread has already been resolved.",
        signInRequired: false,
        unavailable: false,
      };
    }
  }

  return {
    message: "Comments could not be updated. Check your connection and try again.",
    signInRequired: false,
    unavailable: false,
  };
}

export function usePublicShareComments(token: string) {
  const [threads, setThreads] = useState<BoardCommentThread[]>([]);
  const [permission, setPermission] = useState<ShareLinkPermission | null>(null);
  const [stateToken, setStateToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutation, setMutation] = useState<PublicShareCommentMutation>(null);
  const [error, setError] = useState<string | null>(null);
  const [signInRequired, setSignInRequired] = useState(false);

  const applyFailure = useCallback((caught: unknown) => {
    const failure = publicCommentError(caught);
    setStateToken(token);
    setError(failure.message);
    setSignInRequired(failure.signInRequired);
    if (failure.unavailable) {
      setThreads([]);
      setPermission(null);
    }
    return failure;
  }, [token]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await listPublicShareCommentThreads(token, signal);
    setThreads(result.threads);
    setPermission(result.permission);
    setStateToken(token);
    setError(null);
    setSignInRequired(false);
    return result;
  }, [token]);

  useEffect(() => {
    const controller = new AbortController();

    void listPublicShareCommentThreads(token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setThreads(result.threads);
          setPermission(result.permission);
          setStateToken(token);
          setError(null);
          setSignInRequired(false);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) applyFailure(caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [applyFailure, token]);

  const runMutation = useCallback(async (
    kind: Exclude<PublicShareCommentMutation, null>,
    operation: () => Promise<void>,
  ) => {
    setMutation(kind);
    setError(null);
    setSignInRequired(false);
    try {
      await operation();
      await refresh();
    } catch (caught) {
      const failure = applyFailure(caught);
      throw caught instanceof Error ? caught : new Error(failure.message);
    } finally {
      setMutation(null);
    }
  }, [applyFailure, refresh]);

  const createThread = useCallback(
    (anchor: CommentAnchor, body: string) =>
      runMutation("create", () =>
        createPublicShareCommentThread({ token, anchor, body }),
      ),
    [runMutation, token],
  );

  const reply = useCallback(
    (threadId: string, body: string) =>
      runMutation("reply", () =>
        replyToPublicShareCommentThread({ token, threadId, body }),
      ),
    [runMutation, token],
  );

  const retry = useCallback(async () => {
    setLoading(true);
    try {
      await refresh();
    } catch (caught) {
      applyFailure(caught);
    } finally {
      setLoading(false);
    }
  }, [applyFailure, refresh]);

  const hasCurrentState = stateToken === token;
  const currentPermission = hasCurrentState ? permission : null;

  return {
    threads: hasCurrentState ? threads : [],
    permission: currentPermission,
    canComment: currentPermission === "commenter",
    loading: !hasCurrentState || loading,
    mutation,
    error: hasCurrentState ? error : null,
    signInRequired: hasCurrentState && signInRequired,
    createThread,
    reply,
    retry,
  } as const;
}
