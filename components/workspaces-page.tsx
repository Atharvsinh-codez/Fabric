"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type RefObject,
} from "react";
import AddIcon from "reicon-react/icons/Add2";
import ArrowRightIcon from "reicon-react/icons/ArrowRight";
import RefreshIcon from "reicon-react/icons/Refresh";
import UserIcon from "reicon-react/icons/User";
import CloseIcon from "reicon-react/icons/X";

import { WorkspaceShell } from "@/components/workspace-shell";
import { Button, IconButton } from "@/components/ui";
import {
  createWorkspace,
  listWorkspaces,
  type WorkspaceSummary,
} from "@/lib/boards/client";
import {
  APP_ROUTES,
  dashboardPath,
  workspaceRoutePath,
} from "@/lib/app-routes";

const workspaceDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function workspaceInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function useDialogFocus(
  open: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusPanel = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLInputElement>("#new-workspace-name:not([disabled])")
        ?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusPanel);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, panelRef]);
}

function NewWorkspaceButton({
  buttonRef,
  onClick,
}: {
  buttonRef?: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
}) {
  return (
    <Button
      ref={buttonRef}
      type="button"
      tone="primary"
      className="w-full sm:w-auto"
      leading={
        <AddIcon
          size={16}
          className="shrink-0"
          aria-hidden="true"
          focusable="false"
        />
      }
      onClick={onClick}
    >
      New Workspace
    </Button>
  );
}

function NewWorkspaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (workspace: WorkspaceSummary) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const requestPending = useRef(false);
  const [name, setName] = useState("");
  const [creationState, setCreationState] = useState<"idle" | "creating" | "error">(
    "idle",
  );
  const [creationError, setCreationError] = useState("");
  useDialogFocus(open, panelRef, onClose);

  if (!open) return null;
  const creating = creationState === "creating";

  const submitWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || requestPending.current) return;

    requestPending.current = true;
    setCreationState("creating");
    setCreationError("");
    try {
      onCreated(await createWorkspace(normalizedName));
    } catch (error) {
      requestPending.current = false;
      setCreationState("error");
      setCreationError(
        error instanceof Error
          ? error.message
          : "The workspace could not be created. Check your connection and try again.",
      );
    }
  };

  return (
    <div className="fixed inset-0 z-120 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Close new workspace dialog"
        className="modal-backdrop absolute inset-0"
        disabled={creating}
        onClick={onClose}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-workspace-title"
        aria-describedby="new-workspace-description"
        className="floating-shadow dialog-enter relative flex w-full max-w-md flex-col overflow-hidden rounded-radius-2xl bg-surface-white ring-1 ring-near-black-primary-text/10"
      >
        <header className="flex items-start justify-between gap-4 border-b border-near-black-primary-text/8 p-5">
          <div className="min-w-0">
            <h2
              id="new-workspace-title"
              className="text-balance text-xl font-semibold tracking-tight"
            >
              Create a Workspace
            </h2>
            <p
              id="new-workspace-description"
              className="pt-1 text-pretty text-base text-[var(--text-2)] sm:text-sm"
            >
              Give the shared space a name. You will become its owner.
            </p>
          </div>
          <IconButton
            label="Close new workspace dialog"
            tooltip={false}
            disabled={creating}
            onClick={onClose}
          >
            <CloseIcon
              size={16}
              className="shrink-0"
              aria-hidden="true"
              focusable="false"
            />
          </IconButton>
        </header>

        <form
          className="flex flex-col gap-5 p-5"
          aria-busy={creating}
          onSubmit={submitWorkspace}
        >
          <label
            htmlFor="new-workspace-name"
            className="flex flex-col gap-2 text-base font-medium sm:text-sm"
          >
            Workspace Name
            <input
              id="new-workspace-name"
              name="workspace-name"
              value={name}
              maxLength={120}
              autoComplete="organization"
              disabled={creating}
              required
              placeholder="Product design"
              className="h-10 w-full rounded-radius-md bg-surface-white px-3 text-base font-normal text-near-black-primary-text outline-none ring-1 ring-near-black-primary-text/12 placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm"
              onChange={(event) => setName(event.target.value)}
            />
          </label>

          {creationState === "error" && (
            <p
              role="alert"
              className="rounded-radius-md bg-(--danger-soft) px-3 py-2 text-pretty text-base text-(--danger) ring-1 ring-(--danger-border) sm:text-sm"
            >
              {creationError}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              tone="ghost"
              disabled={creating}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" tone="primary" disabled={creating || !name.trim()}>
              {creating ? "Creating..." : "Create Workspace"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function WorkspacesPage({
  initialWorkspaces,
  initialLoadError = false,
}: {
  initialWorkspaces: WorkspaceSummary[];
  initialLoadError?: boolean;
}) {
  const router = useRouter();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    initialLoadError ? "error" : "ready",
  );
  const [createOpen, setCreateOpen] = useState(false);

  const retryLoad = async () => {
    setLoadState("loading");
    try {
      setWorkspaces(await listWorkspaces());
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  };

  const openCreateDialog = () => setCreateOpen(true);
  const handleWorkspaceCreated = (workspace: WorkspaceSummary) => {
    setWorkspaces((current) => [
      workspace,
      ...current.filter((candidate) => candidate.id !== workspace.id),
    ]);
    setCreateOpen(false);
    router.push(dashboardPath({ workspaceId: workspace.id }));
  };

  return (
    <>
      <WorkspaceShell
        availableWorkspaces={workspaces}
        eyebrow="Fabric"
        title="All Workspaces"
        description="Open a shared space, manage access, or create a new workspace."
        modalOpen={createOpen}
        action={
          loadState === "ready" && workspaces.length > 0 ? (
            <NewWorkspaceButton
              buttonRef={createTriggerRef}
              onClick={openCreateDialog}
            />
          ) : undefined
        }
      >
      <section
        aria-labelledby="workspace-list-heading"
        aria-busy={loadState === "loading"}
        className="@container"
      >
        <div className="flex items-end justify-between gap-4 pb-4">
          <div className="min-w-0">
            <h2 id="workspace-list-heading" className="text-base font-semibold">
              Your Workspaces
            </h2>
            <p className="pt-1 text-pretty text-base text-muted-gray sm:text-sm">
              Only workspaces where you are a member appear here.
            </p>
          </div>
          {loadState === "ready" && workspaces.length > 0 && (
            <p className="shrink-0 text-base text-muted-gray tabular-nums sm:text-sm">
              {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
            </p>
          )}
        </div>

        {loadState === "loading" && (
          <div className="grid gap-4 @[42rem]:grid-cols-2" aria-label="Loading workspaces">
            <p className="sr-only" role="status">
              Loading workspaces
            </p>
            {[0, 1].map((item) => (
              <div
                key={item}
                className="min-h-44 animate-pulse rounded-radius-xl bg-surface-white ring-1 ring-near-black-primary-text/7 motion-reduce:animate-none"
              />
            ))}
          </div>
        )}

        {loadState === "error" && (
          <div
            role="alert"
            className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-radius-xl bg-surface-white p-5 ring-1 ring-near-black-primary-text/7"
          >
            <div>
              <h3 className="text-base font-semibold">Workspaces Could Not Be Loaded</h3>
              <p className="pt-1 text-pretty text-base text-[var(--text-2)] sm:text-sm">
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
              Retry Workspaces
            </Button>
          </div>
        )}

        {loadState === "ready" && workspaces.length === 0 && (
          <div className="flex min-h-52 flex-col items-start justify-center gap-4 rounded-radius-xl bg-surface-white p-5 ring-1 ring-near-black-primary-text/7">
            <div>
              <h3 className="text-base font-semibold">Create Your First Workspace</h3>
              <p className="max-w-[52ch] pt-1 text-pretty text-base text-[var(--text-2)] sm:text-sm">
                Start a shared space for boards, members, comments, and permissions.
              </p>
            </div>
            <NewWorkspaceButton onClick={openCreateDialog} />
          </div>
        )}

        {loadState === "ready" && workspaces.length > 0 && (
          <ul role="list" className="grid gap-4 @[42rem]:grid-cols-2">
            {workspaces.map((workspace, index) => (
              <li
                key={workspace.id}
                className="board-card-enter min-w-0"
                style={
                  {
                    "--board-card-delay": `${Math.min(index, 5) * 55}ms`,
                  } as CSSProperties
                }
              >
                <article className="soft-shadow flex h-full min-h-44 flex-col rounded-radius-xl bg-surface-white p-4 ring-1 ring-near-black-primary-text/7">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div
                      aria-hidden="true"
                      className="grid size-10 shrink-0 place-items-center rounded-radius-lg bg-sky-blue-accent text-sm font-semibold text-surface-white ring-1 ring-sky-blue-accent"
                    >
                      {workspaceInitials(workspace.name) || "FW"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold">{workspace.name}</h3>
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <p className="rounded-radius-pill bg-light-surface-tint px-2 py-1 text-base font-medium capitalize text-dark-text-alt ring-1 ring-near-black-primary-text/6 sm:text-sm">
                          {workspace.role}
                        </p>
                        <time
                          dateTime={workspace.updatedAt}
                          className="text-base text-muted-gray sm:text-sm"
                        >
                          Updated {workspaceDateFormatter.format(new Date(workspace.updatedAt))}
                        </time>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-near-black-primary-text/8 pt-3 text-base sm:text-sm">
                    <Link
                      href={dashboardPath({ workspaceId: workspace.id })}
                      className="group inline-flex h-9 items-center gap-2 rounded-radius-md px-2.5 font-medium text-near-black-primary-text outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8"
                    >
                      Open Dashboard
                      <ArrowRightIcon
                        size={16}
                        color="var(--color-muted-gray)"
                        className="shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-0.5"
                        aria-hidden="true"
                        focusable="false"
                      />
                    </Link>
                    <Link
                      href={workspaceRoutePath(APP_ROUTES.members, workspace.id)}
                      className="inline-flex h-9 items-center rounded-radius-md px-2.5 font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8"
                    >
                      Members
                    </Link>
                    <Link
                      href={workspaceRoutePath(APP_ROUTES.settings, workspace.id)}
                      className="inline-flex h-9 items-center rounded-radius-md px-2.5 font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8"
                    >
                      Settings
                    </Link>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="account-settings-heading"
        className="flex flex-col gap-4 border-t border-near-black-primary-text/8 pt-6 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 items-start gap-3">
          <UserIcon
            size={16}
            color="var(--color-muted-gray)"
            className="shrink-0"
            aria-hidden="true"
            focusable="false"
          />
          <div className="min-w-0">
            <h2 id="account-settings-heading" className="text-base font-semibold">
              Account Settings
            </h2>
            <p className="pt-1 text-pretty text-base text-muted-gray sm:text-sm">
              Update your profile, avatar, and signed-in sessions.
            </p>
          </div>
        </div>
        <div className="text-base sm:text-sm">
          <Link
            href={APP_ROUTES.account}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-radius-md bg-surface-white px-3 font-medium text-near-black-primary-text ring-1 ring-near-black-primary-text/10 outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-8"
          >
            Open Account Settings
          </Link>
        </div>
      </section>

      </WorkspaceShell>

      {createOpen && (
        <NewWorkspaceDialog
          open
          onClose={() => setCreateOpen(false)}
          onCreated={handleWorkspaceCreated}
        />
      )}
    </>
  );
}
