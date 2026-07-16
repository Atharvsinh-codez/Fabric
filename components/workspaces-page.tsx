"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import AddIcon from "reicon-react/icons/Add2";
import ArrowRightIcon from "reicon-react/icons/ArrowRight";
import RefreshIcon from "reicon-react/icons/Refresh";

import { WorkspaceShell } from "@/components/workspace-shell";
import { Button } from "@/components/ui";
import { listWorkspaces, type WorkspaceSummary } from "@/lib/boards/client";

const workspaceDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function NewWorkspaceLink() {
  return (
    <Link
      href="/app/onboarding"
      className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-radius-md bg-sky-blue-accent px-3 text-base font-medium text-surface-white ring-1 ring-sky-blue-accent outline-none transition-colors duration-200 hover:bg-[var(--accent-hover)] active:bg-[var(--accent-pressed)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:w-auto sm:text-sm motion-reduce:transition-none"
    >
      <AddIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
      <span>New workspace</span>
    </Link>
  );
}

export function WorkspacesPage({
  initialWorkspaces,
  initialLoadError = false,
}: {
  initialWorkspaces: WorkspaceSummary[];
  initialLoadError?: boolean;
}) {
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    initialLoadError ? "error" : "ready",
  );

  const retryLoad = async () => {
    setLoadState("loading");
    try {
      setWorkspaces(await listWorkspaces());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };

  return (
    <WorkspaceShell
      eyebrow="Fabric"
      title="Workspaces"
      description="Choose where you want to work or start a new workspace."
      action={loadState === "ready" && workspaces.length > 0 ? <NewWorkspaceLink /> : undefined}
    >
      <section
        aria-labelledby="workspace-list-heading"
        aria-busy={loadState === "loading"}
        className="@container"
      >
        <div className="flex items-end justify-between gap-4 pb-4">
          <div>
            <h2 id="workspace-list-heading" className="text-base font-semibold">
              Your workspaces
            </h2>
            <p className="mt-1 text-sm text-muted-gray">Boards, members, and access in one place</p>
          </div>
          {loadState === "ready" && (
            <p className="shrink-0 text-sm text-muted-gray tabular-nums">
              {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
            </p>
          )}
        </div>

        {loadState === "loading" && (
          <div className="grid gap-4 @[42rem]:grid-cols-2" aria-label="Loading workspaces">
            <p className="sr-only" role="status">Loading workspaces</p>
            {[0, 1].map((item) => (
              <div
                key={item}
                className="min-h-36 animate-pulse rounded-radius-xl bg-surface-white ring-1 ring-border-subtle motion-reduce:animate-none"
              />
            ))}
          </div>
        )}

        {loadState === "error" && (
          <div role="alert" className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-radius-xl bg-surface-white p-5 ring-1 ring-border-subtle">
            <div>
              <h3 className="text-base font-semibold">Workspaces could not be loaded</h3>
              <p className="mt-1 text-base text-[var(--text-2)] sm:text-sm">
                Check your connection and try again. Your saved work is unchanged.
              </p>
            </div>
            <Button
              tone="secondary"
              leading={
                <RefreshIcon
                  size={16}
                  className="shrink-0"
                  aria-hidden="true"
                  focusable="false"
                />
              }
              onClick={retryLoad}
            >
              Try again
            </Button>
          </div>
        )}

        {loadState === "ready" && workspaces.length === 0 && (
          <div className="flex min-h-48 flex-col items-start justify-center gap-4 rounded-radius-xl bg-surface-white p-5 ring-1 ring-border-subtle">
            <div>
              <h3 className="text-base font-semibold">Create your first workspace</h3>
              <p className="mt-1 max-w-[52ch] text-base text-[var(--text-2)] sm:text-sm">
                A workspace keeps boards, members, comments, and permissions together.
              </p>
            </div>
            <NewWorkspaceLink />
          </div>
        )}

        {loadState === "ready" && workspaces.length > 0 && (
          <ul role="list" className="grid gap-4 @[42rem]:grid-cols-2 @[64rem]:grid-cols-3">
            {workspaces.map((workspace, index) => {
              const initials = workspace.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase();

              return (
                <li
                  key={workspace.id}
                  className="board-card-enter min-w-0"
                  style={{
                    "--board-card-delay": `${Math.min(index, 5) * 55}ms`,
                  } as CSSProperties}
                >
                  <Link
                    href={`/app/product-studio?workspaceId=${encodeURIComponent(workspace.id)}`}
                    className="group soft-shadow relative flex min-h-44 flex-col justify-between gap-6 overflow-hidden rounded-radius-2xl bg-surface-white p-5 ring-1 ring-near-black-primary-text/7 outline-none motion-safe:transition-transform motion-safe:duration-200 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                  >
                    <span className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-linear-to-b from-sky-blue-accent/10 to-transparent" aria-hidden="true" />
                    <span className="flex items-start justify-between gap-4">
                      <span className="flex min-w-0 items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="relative grid size-10 shrink-0 place-items-center rounded-radius-lg bg-sky-blue-accent text-sm font-semibold text-white shadow-sm ring-1 ring-sky-blue-accent"
                        >
                          {initials || "FW"}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{workspace.name}</span>
                          <span className="mt-0.5 text-[0.75rem] capitalize text-muted-gray">
                            {workspace.role}
                          </span>
                        </span>
                      </span>
                      <ArrowRightIcon
                        size={16}
                        color="var(--color-muted-gray)"
                        className="shrink-0 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none"
                        aria-hidden="true"
                        focusable="false"
                      />
                    </span>
                    <time
                      dateTime={workspace.updatedAt}
                      className="border-t border-border-subtle pt-3 text-[0.75rem] text-muted-gray"
                    >
                      Updated {workspaceDateFormatter.format(new Date(workspace.updatedAt))}
                    </time>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </WorkspaceShell>
  );
}
