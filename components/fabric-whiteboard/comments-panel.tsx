"use client";

import {
  ArrowPathIcon,
  CheckIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import { useMemo, useState, type FormEvent } from "react";

import { Button, IconButton, cx } from "@/components/ui";
import type { CommentAnchor, WorkspaceRole } from "@/db/schema/product";
import type { BoardCommentThread } from "@/lib/boards/client";
import { useBoardComments } from "@/lib/boards/use-board-comments";

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function relativeTime(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return "Just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function FabricCommentsPanel({
  boardId,
  role,
  open,
  getAnchor,
  onClose,
}: {
  boardId: string;
  role: WorkspaceRole;
  open: boolean;
  getAnchor: () => CommentAnchor;
  onClose: () => void;
}) {
  const state = useBoardComments(boardId, open);
  const canComment = role !== "viewer";
  const canResolve = role === "owner" || role === "editor";
  const [body, setBody] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  const visibleThreads = useMemo(
    () => state.threads.filter((thread) => Boolean(thread.resolvedAt) === showResolved),
    [showResolved, state.threads],
  );
  const openCount = state.threads.filter((thread) => !thread.resolvedAt).length;

  async function submitThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextBody = body.trim();
    if (!nextBody || !canComment) return;
    try {
      await state.createThread(getAnchor(), nextBody);
      setBody("");
      setShowResolved(false);
    } catch {
      // The hook exposes the safe server error inline.
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>, threadId: string) {
    event.preventDefault();
    const nextBody = replyBody.trim();
    if (!nextBody || !canComment) return;
    try {
      await state.reply(threadId, nextBody);
      setReplyBody("");
      setReplyThreadId(null);
    } catch {
      // The hook exposes the safe server error inline.
    }
  }

  if (!open) return null;

  return (
    <aside
      aria-label="Board Comments"
      className="absolute inset-x-2 bottom-2 z-1000 flex max-h-[68dvh] flex-col overflow-hidden rounded-radius-xl bg-surface-white floating-shadow sm:inset-x-auto sm:top-16 sm:right-3 sm:bottom-3 sm:w-[23rem] sm:max-h-none"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-near-black-primary-text/8 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ChatBubbleLeftRightIcon className="size-4 h-lh shrink-0 fill-sky-blue-accent" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-medium">Comments</h2>
            <p className="text-base text-muted-gray sm:text-sm">
              <span className="tabular-nums">{openCount}</span> open {openCount === 1 ? "thread" : "threads"}
            </p>
          </div>
        </div>
        <IconButton label="Close Comments" onClick={onClose}>
          <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
      </header>

      {canComment ? (
        <form className="flex shrink-0 flex-col gap-2 border-b border-near-black-primary-text/8 p-4" onSubmit={submitThread}>
          <label htmlFor="fabric-new-comment" className="font-medium">
            New Thread
          </label>
          <textarea
            id="fabric-new-comment"
            name="comment"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Add context for the selected object…"
            rows={3}
            maxLength={4_000}
            className="min-h-20 resize-y rounded-radius-md bg-surface-white p-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:text-sm"
          />
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-base text-muted-gray sm:text-sm">
              Anchors to the selection or viewport.
            </p>
            <Button
              type="submit"
              tone="primary"
              disabled={!body.trim() || state.mutation !== null}
              leading={<PaperAirplaneIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
            >
              {state.mutation === "create" ? "Posting…" : "Post Thread"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="shrink-0 border-b border-near-black-primary-text/8 px-4 py-3 text-base text-muted-gray sm:text-sm">
          Viewer access can read comments but cannot add new threads.
        </p>
      )}

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-near-black-primary-text/8 p-2" role="tablist" aria-label="Comment Status">
        <button
          type="button"
          role="tab"
          aria-selected={!showResolved}
          className={cx(
            "relative h-8 shrink-0 rounded-radius-md px-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent",
            !showResolved ? "bg-light-surface-tint text-near-black-primary-text" : "text-muted-gray hover:bg-light-surface-tint",
          )}
          onClick={() => setShowResolved(false)}
        >
          Open
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={showResolved}
          className={cx(
            "relative h-8 shrink-0 rounded-radius-md px-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent",
            showResolved ? "bg-light-surface-tint text-near-black-primary-text" : "text-muted-gray hover:bg-light-surface-tint",
          )}
          onClick={() => setShowResolved(true)}
        >
          Resolved
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {state.error ? (
          <div className="flex flex-col gap-3 rounded-radius-lg bg-(--danger-soft) p-3 text-(--danger)" role="alert">
            <p className="text-pretty text-base sm:text-sm">{state.error}</p>
            <Button
              className="self-start"
              onClick={() => void state.retry()}
              leading={<ArrowPathIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
            >
              Retry Comments
            </Button>
          </div>
        ) : state.loading ? (
          <p className="text-base text-muted-gray sm:text-sm" role="status">Loading comments…</p>
        ) : visibleThreads.length === 0 ? (
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            {showResolved
              ? "No resolved threads yet. Resolve an open thread when its discussion is complete."
              : canComment
                ? "No open threads yet. Select an object and post the first thread."
                : "No open threads on this board."}
          </p>
        ) : (
          <ul className="flex flex-col gap-4" role="list">
            {visibleThreads.map((thread) => (
              <CommentThreadCard
                key={thread.id}
                thread={thread}
                canComment={canComment}
                canResolve={canResolve}
                busy={state.mutation !== null}
                replyOpen={replyThreadId === thread.id}
                replyBody={replyThreadId === thread.id ? replyBody : ""}
                onReplyOpen={() => {
                  setReplyThreadId(thread.id);
                  setReplyBody("");
                }}
                onReplyChange={setReplyBody}
                onReplyCancel={() => {
                  setReplyThreadId(null);
                  setReplyBody("");
                }}
                onReply={(event) => void submitReply(event, thread.id)}
                onResolution={() => {
                  void state.setResolved(thread.id, !thread.resolvedAt).catch(() => undefined);
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function CommentThreadCard({
  thread,
  canComment,
  canResolve,
  busy,
  replyOpen,
  replyBody,
  onReplyOpen,
  onReplyChange,
  onReplyCancel,
  onReply,
  onResolution,
}: {
  thread: BoardCommentThread;
  canComment: boolean;
  canResolve: boolean;
  busy: boolean;
  replyOpen: boolean;
  replyBody: string;
  onReplyOpen: () => void;
  onReplyChange: (value: string) => void;
  onReplyCancel: () => void;
  onReply: (event: FormEvent<HTMLFormElement>) => void;
  onResolution: () => void;
}) {
  const anchorLabel = thread.anchor.nodeId ? "Object thread" : "Canvas thread";

  return (
    <li className="flex flex-col gap-3 border-b border-near-black-primary-text/8 pb-4 last:border-b-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-light-surface-tint text-[0.6875rem] font-medium text-sky-blue-accent outline-1 -outline-offset-1 outline-black/5">
            {initials(thread.creatorName)}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{thread.creatorName ?? "Fabric Member"}</p>
            <p className="text-base text-muted-gray sm:text-sm">
              {anchorLabel} · {relativeTime(thread.createdAt)}
            </p>
          </div>
        </div>
        {canResolve ? (
          <Button
            tone="ghost"
            disabled={busy}
            onClick={onResolution}
            leading={<CheckIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          >
            {thread.resolvedAt ? "Reopen" : "Resolve"}
          </Button>
        ) : null}
      </div>

      <ul className="flex flex-col gap-3 pl-9" role="list">
        {thread.comments.map((comment) => (
          <li key={comment.id} className="flex flex-col gap-1">
            <p className="text-pretty whitespace-pre-wrap text-base text-near-black-primary-text sm:text-sm">
              {comment.deletedAt ? "Comment removed." : (comment.body ?? "Comment removed.")}
            </p>
            <p className="text-base text-muted-gray sm:text-sm">
              {comment.authorName ?? "Fabric Member"} · {relativeTime(comment.createdAt)}
            </p>
          </li>
        ))}
      </ul>

      {replyOpen ? (
        <form className="flex flex-col gap-2 pl-9" onSubmit={onReply}>
          <label htmlFor={`reply-${thread.id}`} className="font-medium">Reply</label>
          <textarea
            id={`reply-${thread.id}`}
            name="reply"
            value={replyBody}
            onChange={(event) => onReplyChange(event.target.value)}
            maxLength={4_000}
            rows={2}
            className="resize-y rounded-radius-md bg-surface-white p-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={onReplyCancel}>Cancel Reply</Button>
            <Button type="submit" disabled={!replyBody.trim() || busy}>Post Reply</Button>
          </div>
        </form>
      ) : canComment ? (
        <Button className="self-start" tone="ghost" onClick={onReplyOpen}>
          Reply to Thread
        </Button>
      ) : null}
    </li>
  );
}
