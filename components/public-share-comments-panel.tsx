"use client";

import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  PaperAirplaneIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { Button, IconButton, cx } from "@/components/ui";
import type { BoardCommentThread } from "@/lib/boards/client";
import type { usePublicShareComments } from "@/lib/boards/use-public-share-comments";

type PublicShareCommentsState = ReturnType<typeof usePublicShareComments>;

function initials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function commentTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function touchTarget() {
  return (
    <span
      className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
      aria-hidden="true"
    />
  );
}

export function PublicShareCommentsPanel({
  token,
  open,
  state,
  onClose,
}: {
  token: string;
  open: boolean;
  state: PublicShareCommentsState;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  const visibleThreads = useMemo(
    () => state.threads.filter((thread) => Boolean(thread.resolvedAt) === showResolved),
    [showResolved, state.threads],
  );
  const openCount = state.threads.filter((thread) => !thread.resolvedAt).length;
  const returnPath = `/share/${token}`;
  const signInHref = `/login?returnTo=${encodeURIComponent(returnPath)}`;

  async function submitThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextBody = body.trim();
    if (!nextBody || !state.canComment) return;

    try {
      await state.createThread({}, nextBody);
      setBody("");
      setShowResolved(false);
    } catch {
      // The hook keeps the safe error and authentication state visible.
    }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>, threadId: string) {
    event.preventDefault();
    const nextBody = replyBody.trim();
    if (!nextBody || !state.canComment) return;

    try {
      await state.reply(threadId, nextBody);
      setReplyBody("");
      setReplyThreadId(null);
    } catch {
      // The hook keeps the safe error and authentication state visible.
    }
  }

  if (!open) return null;

  return (
    <aside
      id="shared-comments-panel"
      aria-label="Shared Board Comments"
      className="panel-enter absolute inset-x-2 bottom-2 z-1000 flex max-h-[min(76dvh,42rem)] flex-col overflow-hidden rounded-radius-xl bg-surface-white ring-1 ring-black/5 floating-shadow sm:inset-x-auto sm:right-3 sm:bottom-3 sm:w-[23rem] lg:static lg:max-h-none lg:w-[23rem] lg:shrink-0 lg:rounded-none lg:border-l lg:border-near-black-primary-text/8 lg:ring-0 lg:[box-shadow:none]"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-near-black-primary-text/8 px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <ChatBubbleLeftRightIcon
            className="size-4 h-lh shrink-0 fill-sky-blue-accent"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 className="font-medium">Comments</h2>
            <p className="text-base text-muted-gray sm:text-sm" aria-live="polite">
              <span className="tabular-nums">{openCount}</span> open{" "}
              {openCount === 1 ? "thread" : "threads"}
            </p>
          </div>
        </div>
        <IconButton label="Close Comments" onClick={onClose}>
          <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {state.error ? (
          <div
            className={cx(
              "m-4 flex flex-col gap-3 rounded-radius-lg p-3",
              state.signInRequired
                ? "bg-(--accent-soft) text-(--accent-strong)"
                : "bg-(--danger-soft) text-(--danger)",
            )}
            role="alert"
          >
            <p className="text-pretty text-base sm:text-sm">{state.error}</p>
            {state.signInRequired ? (
              <Link
                href={signInHref}
                className="relative w-fit rounded-radius-md bg-sky-blue-accent px-3 py-2 font-medium text-white ring-1 ring-sky-blue-accent outline-none hover:brightness-95 active:brightness-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:py-1.5"
              >
                Sign In to Comment
                {touchTarget()}
              </Link>
            ) : (
              <Button
                className="self-start"
                onClick={() => void state.retry()}
                leading={
                  <ArrowPathIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                }
              >
                Retry Comments
                {touchTarget()}
              </Button>
            )}
          </div>
        ) : null}

        {state.loading && state.threads.length === 0 ? (
          <div className="grid gap-3 p-4" role="status" aria-label="Loading comments">
            <div className="h-4 w-28 animate-pulse rounded-radius-sm bg-light-surface-tint" />
            <div className="h-20 animate-pulse rounded-radius-md bg-light-surface-tint" />
            <p className="text-base text-muted-gray sm:text-sm">Loading comments...</p>
          </div>
        ) : (
          <>
            {state.canComment ? (
              <form
                className="flex flex-col gap-2 border-b border-near-black-primary-text/8 p-4"
                onSubmit={submitThread}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor="shared-new-comment" className="font-medium">
                    New Thread
                  </label>
                  <p className="text-base text-muted-gray sm:text-sm">Board level</p>
                </div>
                <textarea
                  id="shared-new-comment"
                  name="comment"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Add a question or leave feedback..."
                  rows={3}
                  maxLength={4_000}
                  className="min-h-20 resize-y rounded-radius-md bg-surface-white p-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:text-sm"
                />
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-pretty text-base text-muted-gray sm:text-sm">
                    A Fabric account is required to post.
                  </p>
                  <Button
                    type="submit"
                    tone="primary"
                    className="min-w-28"
                    disabled={!body.trim() || state.mutation !== null}
                    leading={
                      <PaperAirplaneIcon
                        className="size-4 shrink-0 fill-current"
                        aria-hidden="true"
                      />
                    }
                  >
                    {state.mutation === "create" ? "Posting..." : "Post Thread"}
                    {touchTarget()}
                  </Button>
                </div>
              </form>
            ) : state.permission === "viewer" ? (
              <p className="border-b border-near-black-primary-text/8 px-4 py-3 text-pretty text-base text-muted-gray sm:text-sm">
                This viewer link can read comments. Ask the board owner for a commenter link to respond.
              </p>
            ) : null}

            <div
              className="flex gap-1 overflow-x-auto border-b border-near-black-primary-text/8 p-2"
              role="tablist"
              aria-label="Comment Status"
            >
              <CommentTab
                selected={!showResolved}
                label="Open"
                count={openCount}
                onClick={() => setShowResolved(false)}
              />
              <CommentTab
                selected={showResolved}
                label="Resolved"
                count={state.threads.length - openCount}
                onClick={() => setShowResolved(true)}
              />
            </div>

            <div id="shared-comment-thread-list" className="p-4">
              {visibleThreads.length === 0 ? (
                <p className="text-pretty text-base text-muted-gray sm:text-sm">
                  {showResolved
                    ? "No resolved threads yet. Completed discussions will appear here."
                    : state.canComment
                      ? "No open threads yet. Post the first question or piece of feedback."
                      : "No open threads on this shared board."}
                </p>
              ) : (
                <ul className="flex flex-col gap-5" role="list">
                  {visibleThreads.map((thread) => (
                    <PublicCommentThread
                      key={thread.id}
                      thread={thread}
                      canReply={state.canComment && !thread.resolvedAt}
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
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

function CommentTab({
  selected,
  label,
  count,
  onClick,
}: {
  selected: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls="shared-comment-thread-list"
      className={cx(
        "relative flex h-8 shrink-0 items-center gap-2 rounded-radius-md py-1.5 pr-2.5 pl-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent",
        selected
          ? "bg-light-surface-tint text-near-black-primary-text"
          : "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text",
      )}
      onClick={onClick}
    >
      {label}
      <span className="min-w-4 tabular-nums">{count}</span>
      {touchTarget()}
    </button>
  );
}

function PublicCommentThread({
  thread,
  canReply,
  busy,
  replyOpen,
  replyBody,
  onReplyOpen,
  onReplyChange,
  onReplyCancel,
  onReply,
}: {
  thread: BoardCommentThread;
  canReply: boolean;
  busy: boolean;
  replyOpen: boolean;
  replyBody: string;
  onReplyOpen: () => void;
  onReplyChange: (value: string) => void;
  onReplyCancel: () => void;
  onReply: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const anchorLabel = thread.anchor.nodeId
    ? "Object Thread"
    : thread.anchor.x !== undefined || thread.anchor.y !== undefined
      ? "Canvas Thread"
      : "Board Thread";

  return (
    <li className="flex flex-col gap-4 border-b border-near-black-primary-text/8 pb-5 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <p className="rounded-radius-pill bg-light-surface-tint px-2 py-1 font-mono text-sm text-dark-text-alt">
          {anchorLabel}
        </p>
        {thread.resolvedAt ? (
          <p className="rounded-radius-pill bg-(--success-soft) px-2 py-1 font-medium text-(--success)">
            Resolved
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-4" role="list">
        {thread.comments.map((comment) => (
          <li key={comment.id} className="flex min-w-0 items-start gap-2.5">
            <div className="grid size-7 shrink-0 place-items-center rounded-full bg-light-surface-tint text-[0.6875rem] font-medium text-sky-blue-accent outline-1 -outline-offset-1 outline-black/5">
              {initials(comment.authorName)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <p className="truncate font-medium">
                  {comment.authorName ?? "Fabric Member"}
                </p>
                <p className="text-base text-muted-gray sm:text-sm">
                  <time dateTime={comment.createdAt}>{commentTime(comment.createdAt)}</time>
                </p>
              </div>
              <p className="text-pretty whitespace-pre-wrap text-base text-near-black-primary-text sm:text-sm">
                {comment.deletedAt ? "Comment removed." : (comment.body ?? "Comment removed.")}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {replyOpen ? (
        <form className="flex flex-col gap-2 pl-9" onSubmit={onReply}>
          <label htmlFor={`shared-reply-${thread.id}`} className="font-medium">
            Reply
          </label>
          <textarea
            id={`shared-reply-${thread.id}`}
            name="reply"
            value={replyBody}
            onChange={(event) => onReplyChange(event.target.value)}
            placeholder="Write a reply..."
            maxLength={4_000}
            rows={2}
            className="resize-y rounded-radius-md bg-surface-white p-2.5 text-base outline-none ring-1 ring-near-black-primary-text/10 placeholder:text-muted-gray focus-visible:-outline-offset-1 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button tone="ghost" onClick={onReplyCancel}>
              Cancel Reply
              {touchTarget()}
            </Button>
            <Button type="submit" disabled={!replyBody.trim() || busy}>
              {busy ? "Posting..." : "Post Reply"}
              {touchTarget()}
            </Button>
          </div>
        </form>
      ) : canReply ? (
        <Button className="self-start" tone="ghost" onClick={onReplyOpen}>
          Reply to Thread
          {touchTarget()}
        </Button>
      ) : null}
    </li>
  );
}
