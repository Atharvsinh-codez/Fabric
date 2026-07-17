"use client";

import {
  ArrowLeftIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  EyeIcon,
  ListBulletIcon,
  LockClosedIcon,
  Squares2X2Icon,
} from "@heroicons/react/16/solid";
import Link from "next/link";
import { useState } from "react";

import { PublicShareCommentsPanel } from "@/components/public-share-comments-panel";
import { SharedTldrawCanvas } from "@/components/shared-tldraw-canvas";
import { FabricLogo, cx } from "@/components/ui";
import type { PublicBoardShare } from "@/lib/boards/public-share";
import { usePublicShareComments } from "@/lib/boards/use-public-share-comments";

type ViewMode = "canvas" | "list";

function AccessUnavailable() {
  return (
    <main className="isolate flex min-h-dvh flex-col bg-surface-white font-sans text-near-black-primary-text">
      <header className="flex h-16 items-center border-b border-border-subtle px-5 sm:px-8">
        <Link
          href="/"
          aria-label="Homepage"
          className="rounded-radius-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          <FabricLogo />
        </Link>
      </header>
      <section className="flex flex-1 items-center px-5 py-16 sm:px-8">
        <div className="mx-auto grid w-full max-w-lg gap-8">
          <div className="grid gap-4">
            <LockClosedIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
            <h1 className="max-w-[35ch] text-balance text-3xl font-semibold tracking-tight">
              This shared board is unavailable
            </h1>
            <p className="max-w-[52ch] text-pretty text-base text-dark-text-alt">
              The link may be invalid, expired, revoked, or connected to an archived board. Ask the board owner for a new link.
            </p>
          </div>
          <div className="border-t border-border-subtle pt-6">
            <Link
              href="/"
              className="flex w-fit items-center gap-2 rounded-radius-md font-medium text-sky-blue-accent outline-none hover:underline hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
            >
              <ArrowLeftIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
              Return to Fabric
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function SemanticListView({ share }: { share: PublicBoardShare }) {
  return (
    <section
      id="shared-list-view"
      aria-labelledby="shared-list-title"
      className="min-h-0 flex-1 overflow-y-auto bg-surface-white"
    >
      <div className="mx-auto grid max-w-3xl gap-8 px-5 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-3">
          <h2 id="shared-list-title" className="text-balance text-2xl font-semibold tracking-tight">
            Board Content
          </h2>
          <p className="max-w-[52ch] text-pretty text-base text-dark-text-alt sm:text-sm">
            {share.nodes.length} {share.nodes.length === 1 ? "object" : "objects"} in a semantic reading view.
          </p>
        </div>
        {share.nodes.length > 0 ? (
          <ol role="list" className="divide-y divide-border-subtle border-y border-border-subtle">
            {share.nodes.map((node, index) => (
              <li key={node.id} className="grid gap-2 py-5 sm:grid-cols-[7rem_1fr] sm:gap-6 sm:py-4">
                <div className="flex items-baseline gap-2 sm:flex-col sm:gap-1">
                  <p className="font-mono text-sm text-muted-gray">{String(index + 1).padStart(2, "0")}</p>
                  <p className="text-base font-medium capitalize text-dark-text-alt sm:text-sm">{node.type}</p>
                </div>
                <article className="grid min-w-0 gap-2">
                  <h3 className="font-semibold">{node.title}</h3>
                  {node.body && <p className="text-pretty text-base text-dark-text-alt sm:text-sm">{node.body}</p>}
                  <p className="text-base text-muted-gray sm:text-sm">
                    Position {Math.round(node.x)}, {Math.round(node.y)} · {Math.round(node.width)} × {Math.round(node.height)}
                  </p>
                </article>
              </li>
            ))}
          </ol>
        ) : (
          <p className="border-y border-border-subtle py-6 text-base text-dark-text-alt sm:text-sm">
            This board does not contain any objects yet.
          </p>
        )}
      </div>
    </section>
  );
}

function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (nextView: ViewMode) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-radius-lg bg-light-surface-tint p-1" aria-label="Board view">
      {([
        ["canvas", "Canvas", Squares2X2Icon],
        ["list", "List", ListBulletIcon],
      ] as const).map(([value, label, Icon]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          aria-controls={`shared-${value}-view`}
          onClick={() => onChange(value)}
          className={cx(
            "flex h-11 items-center gap-1.5 rounded-radius-md px-2.5 text-sm font-medium outline-none active:bg-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8",
            view === value
              ? "bg-surface-white text-near-black-primary-text ring-1 ring-border-subtle"
              : "text-dark-text-alt hover:text-near-black-primary-text",
          )}
        >
          <Icon className="size-4 shrink-0 fill-current" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function SharedBoardPage({ share }: { share: PublicBoardShare | null }) {
  if (!share) return <AccessUnavailable />;

  return <AvailableSharedBoardPage share={share} />;
}

function AvailableSharedBoardPage({ share }: { share: PublicBoardShare }) {
  const [view, setView] = useState<ViewMode>("canvas");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const comments = usePublicShareComments(share.token);
  const openCommentCount = comments.threads.filter((thread) => !thread.resolvedAt).length;

  return (
    <main className="isolate flex min-h-dvh flex-col overflow-hidden bg-light-surface-tint font-sans text-near-black-primary-text">
      <header className="grid shrink-0 gap-3 border-b border-border-subtle bg-surface-white px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center sm:px-5 lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/"
            aria-label="Homepage"
            className="shrink-0 rounded-radius-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
          >
            <FabricLogo compact />
          </Link>
          <span className="h-5 w-px shrink-0 bg-border-subtle" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="truncate font-semibold">{share.title}</h1>
            <p className="truncate text-sm text-muted-gray">{share.workspaceName} · Shared board</p>
          </div>
        </div>
        <div className="row-start-2 justify-self-start sm:row-start-auto sm:justify-self-end lg:col-start-2 lg:justify-self-center">
          <ViewToggle view={view} onChange={setView} />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 sm:justify-end lg:col-span-1">
          <div className="flex items-center gap-1.5 rounded-radius-pill bg-sky-blue-accent/10 py-1 pr-2.5 pl-1.5 text-sm font-medium text-sky-blue-accent">
            <EyeIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            {share.permission === "commenter" ? "Commenter link" : "Viewer link"}
          </div>
          <div className="flex items-center gap-1.5 rounded-radius-pill bg-light-surface-tint py-1 pr-2.5 pl-1.5 text-sm text-dark-text-alt">
            <ClockIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
            {share.expiresAt
              ? `Expires ${new Date(share.expiresAt).toLocaleDateString()}`
              : "No expiry"}
          </div>
          <button
            type="button"
            aria-expanded={commentsOpen}
            aria-controls="shared-comments-panel"
            aria-label={`${commentsOpen ? "Close" : "Open"} Comments, ${openCommentCount} open ${openCommentCount === 1 ? "thread" : "threads"}`}
            onClick={() => setCommentsOpen((current) => !current)}
            className={cx(
              "relative flex h-11 items-center gap-1.5 rounded-radius-md py-2 pr-2.5 pl-2 font-medium outline-none active:bg-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8 sm:py-1.5",
              commentsOpen
                ? "bg-light-surface-tint text-sky-blue-accent ring-1 ring-border-subtle"
                : "bg-surface-white text-dark-text-alt ring-1 ring-border-subtle hover:bg-light-surface-tint hover:text-near-black-primary-text",
            )}
          >
            <ChatBubbleLeftRightIcon
              className="size-4 shrink-0 fill-current"
              aria-hidden="true"
            />
            Comments
            <span className="min-w-4 font-mono tabular-nums">{openCommentCount}</span>
            <span
              className="pointer-events-none absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
              aria-hidden="true"
            />
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative z-0 flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-surface-white px-4 py-2.5 sm:px-5 sm:py-2">
            <div className="flex min-w-0 items-center gap-2">
              <LockClosedIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
              <p className="truncate text-base text-dark-text-alt sm:text-sm">
                Canvas is read-only · {share.permission === "commenter" ? "Signed-in guests can comment." : "Comments are view-only."}
              </p>
            </div>
          </div>
          {view === "canvas" ? <SharedTldrawCanvas share={share} /> : <SemanticListView share={share} />}
        </div>
        <PublicShareCommentsPanel
          token={share.token}
          open={commentsOpen}
          state={comments}
          onClose={() => setCommentsOpen(false)}
        />
      </div>
    </main>
  );
}
