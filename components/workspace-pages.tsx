"use client";

import {
  ArrowRightIcon,
  Bars3Icon,
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  Cog6ToothIcon,
  CommandLineIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
  XMarkIcon,
} from "@heroicons/react/16/solid";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import { updateCurrentProfile } from "@/app/actions/account";
import { signOutCurrentSession } from "@/app/actions/auth";
import { BoardThemeSelector } from "@/components/board-theme-selector";
import { getUserInitials, useCurrentUser } from "@/components/current-user-provider";
import { FabricDialog } from "@/components/fabric-whiteboard/fabric-dialog";
import { ProjectMembersPanel } from "@/components/project-members-panel";
import { Button, FabricLogo, IconButton, UserAvatar, cx } from "@/components/ui";
import { WorkspaceShell as SharedWorkspaceShell } from "@/components/workspace-shell";
import {
  listAccountSessions as listAccountSessionsRequest,
  revokeAccountSession as revokeAccountSessionRequest,
  type AccountSession,
} from "@/lib/account/client";
import {
  APP_ROUTES,
  boardPath,
  dashboardPath,
  workspaceRoutePath,
  type WorkspaceAppRoute,
} from "@/lib/app-routes";
import type { WorkspaceActivityItem } from "@/lib/boards/activity-contracts";
import {
  addWorkspaceMember as addWorkspaceMemberRequest,
  createBoard as createBoardRequest,
  deleteWorkspace as deleteWorkspaceRequest,
  FabricApiError,
  listBoards,
  listWorkspaceActivity,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember as removeWorkspaceMemberRequest,
  updateWorkspaceMember as updateWorkspaceMemberRequest,
  type BoardSummary as StoredBoardSummary,
  type WorkspaceMember,
  type WorkspaceSummary,
} from "@/lib/boards/client";
import type { WorkspaceRole } from "@/db/schema/product";
import {
  DEFAULT_NEW_BOARD_THEME,
  type BoardTheme,
} from "@/lib/boards/board-theme";
import { submitOnboarding } from "@/lib/onboarding/client";

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>;

const initialProfileActionState = {
  status: "idle",
  message: "",
} as const;

const workspaceNavigation: Array<{
  label: string;
  href: WorkspaceAppRoute;
  icon: HeroIcon;
}> = [
  { label: "Boards", href: APP_ROUTES.dashboard, icon: HomeIcon },
  { label: "Members", href: APP_ROUTES.members, icon: UsersIcon },
  { label: "Activity", href: APP_ROUTES.activity, icon: ClockIcon },
  { label: "Settings", href: APP_ROUTES.settings, icon: Cog6ToothIcon },
];

const fieldClass =
  "h-10 w-full rounded-radius-md bg-surface-white px-3 text-base text-near-black-primary-text outline-none ring-1 ring-border-subtle placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm";

const selectClass =
  "col-span-full row-start-1 h-10 appearance-none rounded-radius-md bg-surface-white pr-8 pl-3 text-base text-near-black-primary-text outline-none ring-1 ring-border-subtle focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-9 sm:text-sm";

const realtimeConfigured = Boolean(process.env.NEXT_PUBLIC_REALTIME_URL?.trim());

function isCurrentRoute(pathname: string, href: string) {
  if (href === APP_ROUTES.dashboard) {
    return pathname === href || pathname.startsWith("/app/boards/");
  }

  return pathname === href;
}

function WorkspaceNav({
  onNavigate,
  workspaceId,
}: {
  onNavigate?: () => void;
  workspaceId?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Workspace" className="flex flex-col gap-1 text-base sm:text-sm">
      {workspaceNavigation.map((item) => {
        const Icon = item.icon;
        const active = isCurrentRoute(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={workspaceRoutePath(item.href, workspaceId)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-11 items-center gap-2 rounded-radius-md px-2 font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9",
              active
                ? "bg-light-surface-tint text-near-black-primary-text"
                : "text-dark-text-alt hover:bg-light-surface-tint hover:text-near-black-primary-text",
            )}
          >
            <Icon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            <span className="min-w-0 truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccountLink({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const active = pathname === "/app/account";
  const initials = getUserInitials(user);

  return (
    <div className="text-base sm:text-sm">
      <Link
        href="/app/account"
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex min-w-0 items-center gap-2 rounded-radius-md p-2 font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent",
          active ? "bg-light-surface-tint" : "hover:bg-light-surface-tint",
        )}
      >
        <div className="grid size-7 shrink-0 place-items-center rounded-radius-pill bg-slate-button-dark text-[0.6875rem] text-surface-white outline-1 -outline-offset-1 outline-black/10">
          {initials}
        </div>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{user.name || "Fabric member"}</span>
          <p className="truncate text-[0.75rem] font-normal text-muted-gray">
            {user.email || "Signed in"}
          </p>
        </span>
        <ChevronDownIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
      </Link>
    </div>
  );
}

function WorkspaceSidebarContent({
  onNavigate,
  workspaceId,
  workspaceName,
}: {
  onNavigate?: () => void;
  workspaceId?: string;
  workspaceName?: string;
}) {
  const workspaceLabel = workspaceName ?? (workspaceId ? "Workspace" : "All workspaces");
  const workspaceInitials = workspaceLabel
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link
          href="/"
          aria-label="Homepage"
          onClick={onNavigate}
          className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          <FabricLogo />
        </Link>
      </div>

      <div className="px-3 text-base sm:text-sm">
        <Link
          href="/app"
          onClick={onNavigate}
          className="flex h-11 min-w-0 items-center gap-2 rounded-radius-md px-2 font-medium outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9"
        >
          <div className="grid size-5 shrink-0 place-items-center rounded-radius-sm bg-slate-button-dark text-[0.6875rem] text-surface-white">
            {workspaceInitials || "FW"}
          </div>
          <span className="min-w-0 flex-1 truncate">{workspaceLabel}</span>
          <ChevronDownIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
        </Link>
      </div>

      <div className="px-3 pt-5">
        <WorkspaceNav onNavigate={onNavigate} workspaceId={workspaceId} />
      </div>

      <RecentBoardLinks workspaceId={workspaceId} onNavigate={onNavigate} />

      <div className="border-t border-border-subtle p-3">
        <AccountLink onNavigate={onNavigate} />
      </div>
    </>
  );
}

function RecentBoardLinks({
  workspaceId,
  onNavigate,
}: {
  workspaceId?: string;
  onNavigate?: () => void;
}) {
  const [boards, setBoards] = useState<StoredBoardSummary[]>([]);
  const [responseWorkspaceId, setResponseWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void listBoards({ workspaceId, view: "recent" })
      .then((result) => {
        if (active) {
          setBoards(
            result
              .filter((board) => board.workspaceId === workspaceId && !board.archivedAt)
              .slice(0, 3),
          );
          setResponseWorkspaceId(workspaceId);
        }
      })
      .catch(() => {
        if (active) {
          setBoards([]);
          setResponseWorkspaceId(workspaceId);
        }
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  const visibleBoards = responseWorkspaceId === workspaceId ? boards : [];

  return (
    <div className="flex flex-1 flex-col gap-2 px-5 pt-8 text-base sm:text-sm">
      <p className="text-[0.75rem] font-medium text-muted-gray">Recent boards</p>
      {visibleBoards.map((board) => (
        <Link
          key={board.id}
          href={boardPath(board.id)}
          onClick={onNavigate}
          className="truncate text-dark-text-alt outline-none hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
        >
          {board.title}
        </Link>
      ))}
      {visibleBoards.length === 0 && (
        <Link
          href={dashboardPath({ workspaceId })}
          onClick={onNavigate}
          className="text-dark-text-alt outline-none hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
        >
          Browse all boards
        </Link>
      )}
    </div>
  );
}

function LegacyWorkspaceShell({
  eyebrow,
  title,
  description,
  action,
  workspaceId,
  workspaceName,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  workspaceId?: string;
  workspaceName?: string;
  children: ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useCurrentUser();
  const initials = getUserInitials(user);
  const activeWorkspaceId = workspaceId ?? searchParams.get("workspaceId") ?? undefined;

  useEffect(() => {
    if (!commandOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [commandOpen]);

  const searchWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("workspace-search") ?? "").trim();
    router.push(dashboardPath({ workspaceId: activeWorkspaceId, q: query }));
  };

  return (
    <main className="isolate flex min-h-dvh bg-surface-white font-sans text-near-black-primary-text">
      <aside className="hidden w-60 shrink-0 border-r border-border-subtle bg-surface-white lg:flex lg:flex-col">
        <WorkspaceSidebarContent workspaceId={activeWorkspaceId} workspaceName={workspaceName} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle px-4 sm:px-6">
          <div className="lg:hidden">
            <IconButton label="Open Workspace Navigation" onClick={() => setMobileNav(true)}>
              <Bars3Icon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            </IconButton>
          </div>
          <div className="min-w-0 flex-1 lg:hidden">
            <FabricLogo />
          </div>
          <div className="hidden min-w-0 flex-1 lg:block">
             <form className="relative block max-w-sm" role="search" onSubmit={searchWorkspace}>
               <label htmlFor="workspace-search" className="sr-only">Search Workspace</label>
              <MagnifyingGlassIcon
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 fill-muted-gray"
                aria-hidden="true"
              />
               <input
                 key={searchParams.get("q") ?? ""}
                 id="workspace-search"
                 name="workspace-search"
                 type="search"
                 placeholder="Search boards"
                 defaultValue={searchParams.get("q") ?? ""}
                 className="h-8 w-full rounded-radius-md bg-light-surface-tint pr-3 pl-8 text-sm text-near-black-primary-text outline-none ring-1 ring-transparent placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent"
               />
             </form>
          </div>
          <div className="flex shrink-0 items-center gap-1">
             <IconButton label="Open Quick Navigation" onClick={() => setCommandOpen(true)}>
               <CommandLineIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
             </IconButton>
            <div className="text-base lg:hidden">
              <Link
                href={APP_ROUTES.account}
                aria-label="Open Account"
                className="grid size-8 place-items-center rounded-radius-pill bg-slate-button-dark font-medium text-surface-white outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
              >
                <div className="text-[0.6875rem]">{initials}</div>
              </Link>
            </div>
          </div>
        </header>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto min-w-0 w-full max-w-6xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
            <div className="flex flex-col gap-4 border-b border-border-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-mono text-[0.75rem] font-medium tracking-wide text-muted-gray">{eyebrow ?? workspaceName ?? "Fabric"}</p>
                <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="max-w-[68ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                  {description}
                </p>
              </div>
              {action && <div className="shrink-0">{action}</div>}
            </div>
            <div className="flex flex-col gap-10 pt-7">{children}</div>
          </div>
        </div>
      </div>

      {mobileNav && (
        <div className="fixed inset-0 z-100 lg:hidden">
          <button
            type="button"
            className="modal-backdrop absolute inset-0"
            aria-label="Close Navigation"
            onClick={() => setMobileNav(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Workspace Navigation"
            className="floating-shadow panel-enter absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-surface-white"
          >
            <div className="absolute top-3 right-3 z-10">
              <IconButton label="Close Navigation" onClick={() => setMobileNav(false)}>
                <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
              </IconButton>
            </div>
            <WorkspaceSidebarContent
              onNavigate={() => setMobileNav(false)}
              workspaceId={activeWorkspaceId}
              workspaceName={workspaceName}
            />
          </aside>
        </div>
      )}

      {commandOpen && (
        <div className="fixed inset-0 z-110 grid place-items-start px-4 pt-[12vh]">
          <button
            type="button"
            className="modal-backdrop absolute inset-0"
            aria-label="Close Quick Navigation"
            onClick={() => setCommandOpen(false)}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-quick-navigation-title"
            className="floating-shadow panel-enter relative mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-radius-2xl bg-surface-white ring-1 ring-near-black-primary-text/10"
          >
            <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3">
              <div>
                <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-muted-gray">Workspace</p>
                <h2 id="workspace-quick-navigation-title" className="text-base font-semibold">Quick Navigation</h2>
              </div>
              <IconButton label="Close Quick Navigation" onClick={() => setCommandOpen(false)}>
                <XMarkIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
              </IconButton>
            </div>
            <nav aria-label="Quick Navigation" className="grid gap-1 p-2">
              {[...workspaceNavigation, { label: "Account", href: APP_ROUTES.account, icon: UsersIcon }].map((item) => {
                const Icon = item.icon;
                const href =
                  activeWorkspaceId && item.href !== APP_ROUTES.account
                    ? workspaceRoutePath(item.href as WorkspaceAppRoute, activeWorkspaceId)
                    : item.href;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    onClick={() => setCommandOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-radius-lg px-3 text-base font-medium outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:text-sm"
                  >
                    <Icon className="size-4 shrink-0 fill-current text-sky-blue-accent" aria-hidden="true" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </section>
        </div>
      )}
    </main>
  );
}

function PrimaryLink({
  href,
  children,
  leading,
}: {
  href: string;
  children: ReactNode;
  leading?: ReactNode;
}) {
  return (
    <div className="text-base sm:text-sm">
      <Link
        href={href}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-radius-md bg-sky-blue-accent px-3 font-medium text-surface-white ring-1 ring-sky-blue-accent outline-none motion-safe:transition-transform motion-safe:duration-200 hover:bg-sky-blue-accent/90 active:scale-[0.98] active:bg-sky-blue-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
      >
        {leading}
        <span>{children}</span>
      </Link>
    </div>
  );
}

function Toast({ message }: { message: string | null }) {
  if (!message) return null;

  return (
    <div
      role="status"
      className="floating-shadow toast-enter fixed bottom-5 left-1/2 z-200 -translate-x-1/2 rounded-radius-xl bg-slate-button-dark px-3 py-2 text-base font-medium text-surface-white sm:text-sm"
    >
      {message}
    </div>
  );
}

function useToast() {
  const [message, setMessage] = useState<string | null>(null);

  const show = (nextMessage: string) => {
    setMessage(nextMessage);
    window.setTimeout(() => setMessage(null), 2400);
  };

  return { message, show };
}

export function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;

    void listWorkspaces()
      .then((result) => {
        if (!active) return;
        setWorkspaces(result);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [requestVersion]);

  return (
    <SharedWorkspaceShell
      eyebrow="Fabric"
      title="Workspaces"
      description="Choose where you want to work or start a new workspace."
      action={
        <PrimaryLink href={APP_ROUTES.workspaces} leading={<PlusIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}>
          Manage Workspaces
        </PrimaryLink>
      }
    >
      <section aria-labelledby="workspace-list-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="workspace-list-heading" className="text-base font-semibold">
            Your Workspaces
          </h2>
          {loadState === "ready" && (
            <p className="text-base text-muted-gray sm:text-sm">
              {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
            </p>
          )}
        </div>
        {loadState === "loading" && (
          <div className="mt-4 grid gap-4 md:grid-cols-2" aria-label="Loading workspaces">
            {[0, 1].map((item) => (
              <div
                key={item}
                className="min-h-36 animate-pulse rounded-radius-xl bg-light-surface-tint ring-1 ring-border-subtle motion-reduce:animate-none"
              />
            ))}
          </div>
        )}

        {loadState === "error" && (
          <div className="mt-4 flex min-h-36 flex-col items-start justify-center gap-3 rounded-radius-xl bg-light-surface-tint p-5 ring-1 ring-border-subtle">
            <p className="text-base text-dark-text-alt sm:text-sm">
              Workspaces could not be loaded. Your session is still safe.
            </p>
            <Button
              tone="secondary"
              onClick={() => {
                setLoadState("loading");
                setRequestVersion((value) => value + 1);
              }}
            >
              Try Again
            </Button>
          </div>
        )}

        {loadState === "ready" && workspaces.length === 0 && (
          <div className="mt-4 flex min-h-44 flex-col items-start justify-center gap-3 rounded-radius-xl bg-light-surface-tint p-5 ring-1 ring-border-subtle">
            <h3 className="text-base font-semibold">Create your first workspace</h3>
            <p className="max-w-[52ch] text-base text-dark-text-alt sm:text-sm">
              A workspace keeps boards, members, comments, and permissions together.
            </p>
            <PrimaryLink href={APP_ROUTES.workspaces} leading={<PlusIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}>
              Open Workspaces
            </PrimaryLink>
          </div>
        )}

        {loadState === "ready" && workspaces.length > 0 && (
          <ul role="list" className="grid gap-4 pt-4 md:grid-cols-2">
            {workspaces.map((workspace) => {
              const initials = workspace.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join("")
                .toUpperCase();

              return (
                <li key={workspace.id}>
                  <div className="text-base sm:text-sm">
                    <Link
                      href={dashboardPath({ workspaceId: workspace.id })}
                      className="flex min-h-36 flex-col justify-between gap-6 rounded-radius-xl bg-surface-white p-4 ring-1 ring-border-subtle outline-none motion-safe:transition-transform motion-safe:duration-200 hover:-translate-y-0.5 hover:ring-black/10 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                    >
                      <span className="flex items-start justify-between gap-4">
                        <span className="flex min-w-0 items-start gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-radius-md bg-slate-button-dark font-medium text-surface-white">
                            {initials || "FW"}
                          </span>
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{workspace.name}</span>
                            <span className="capitalize text-muted-gray">{workspace.role}</span>
                          </span>
                        </span>
                        <ArrowRightIcon className="size-4 shrink-0 fill-muted-gray" aria-hidden="true" />
                      </span>
                      <span className="border-t border-border-subtle pt-3 text-muted-gray">
                        Updated {new Date(workspace.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </SharedWorkspaceShell>
  );
}

const useCases = [
  { id: "planning", title: "Product planning", detail: "Roadmaps, opportunity maps, and reviews." },
  { id: "research", title: "User research", detail: "Evidence, themes, and synthesis boards." },
  { id: "architecture", title: "Architecture", detail: "Systems, flows, and technical decisions." },
  { id: "other", title: "Something else", detail: "Start with a flexible workspace." },
];

export function OnboardingPage() {
  const router = useRouter();
  const user = useCurrentUser();
  const [step, setStep] = useState(1);
  const [createdWorkspacePath, setCreatedWorkspacePath] = useState<string | null>(null);
  const [creationState, setCreationState] = useState<"idle" | "creating" | "error">("idle");
  const [creationError, setCreationError] = useState("");
  const [name, setName] = useState(user.name || "");
  const [workspace, setWorkspace] = useState(
    user.name?.trim() ? `${user.name.trim()}'s workspace` : "",
  );
  const [useCase, setUseCase] = useState("planning");
  const [boardTheme, setBoardTheme] =
    useState<BoardTheme>(DEFAULT_NEW_BOARD_THEME);
  const selectedUseCase = useCases.find((option) => option.id === useCase)?.title;

  const submitStep = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < 3) {
      setStep((current) => current + 1);
      return;
    }

    setCreationState("creating");
    setCreationError("");

    try {
      const result = await submitOnboarding({
        displayName: name,
        workspaceName: workspace,
        boardTitle: selectedUseCase ? `${selectedUseCase} board` : "First board",
        theme: boardTheme,
        document: { version: 1, nodes: [], edges: [] },
      });
      const path = dashboardPath({ workspaceId: result.workspace.id });
      setCreatedWorkspacePath(path);
      setCreationState("idle");
      router.replace(path);
    } catch (error) {
      setCreationError(
        error instanceof FabricApiError || error instanceof Error
          ? error.message
          : "Fabric could not create the workspace. Try again.",
      );
      setCreationState("error");
    }
  };

  return (
    <main className="isolate min-h-dvh bg-surface-white font-sans text-near-black-primary-text">
      <header className="flex h-14 items-center justify-between border-b border-border-subtle px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Homepage"
          className="outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          <FabricLogo />
        </Link>
        <div className="text-base sm:text-sm">
          <Link
            href="/app"
            className="font-medium text-dark-text-alt outline-none hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
          >
            Back to Workspaces
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <ol role="list" className="grid grid-cols-3 gap-2" aria-label="Onboarding progress">
          {["Workspace", "Use case", "First board"].map((label, index) => {
            const position = index + 1;
            const current = position === step;
            const complete = position < step || createdWorkspacePath !== null;
            return (
              <li key={label} className="flex flex-col gap-2">
                <span
                  className={cx(
                    "h-1 rounded-radius-pill",
                    current || complete ? "bg-sky-blue-accent" : "bg-border-subtle",
                  )}
                  aria-hidden="true"
                />
                <p className={cx("text-base font-medium sm:text-sm", current ? "text-near-black-primary-text" : "text-muted-gray")}>
                  {position}. {label}
                </p>
              </li>
            );
          })}
        </ol>

        <div className="pt-10">
          {createdWorkspacePath ? (
            <section aria-labelledby="ready-heading" className="flex flex-col items-start gap-5">
              <CheckCircleIcon className="size-4 shrink-0 fill-sky-blue-accent" aria-hidden="true" />
              <div className="flex flex-col gap-2">
                <h1 id="ready-heading" className="text-balance text-3xl font-semibold tracking-tight">
                  Your workspace is ready
                </h1>
                <p className="max-w-[60ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                  Opening {workspace}. If navigation does not start, use the link below.
                </p>
              </div>
              <PrimaryLink href={createdWorkspacePath}>
                Open Workspace
              </PrimaryLink>
            </section>
          ) : (
            <form onSubmit={submitStep} className="flex flex-col gap-8">
              {step === 1 && (
                <section aria-labelledby="workspace-step-heading" className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2">
                    <h1 id="workspace-step-heading" className="text-balance text-3xl font-semibold tracking-tight">
                      Set up your workspace
                    </h1>
                    <p className="max-w-[60ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                      Add the names your team will see. You can change both later.
                    </p>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <label htmlFor="onboarding-name" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
                      <span>Your Name</span>
                      <input
                        id="onboarding-name"
                        name="name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                        className={fieldClass}
                      />
                    </label>
                    <label htmlFor="onboarding-workspace" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
                      <span>Workspace Name</span>
                      <input
                        id="onboarding-workspace"
                        name="workspace"
                        value={workspace}
                        onChange={(event) => setWorkspace(event.target.value)}
                        required
                        className={fieldClass}
                      />
                    </label>
                  </div>
                </section>
              )}

              {step === 2 && (
                <section aria-labelledby="use-case-step-heading" className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2">
                    <h1 id="use-case-step-heading" className="text-balance text-3xl font-semibold tracking-tight">
                      What will you make first?
                    </h1>
                    <p className="max-w-[60ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                      This choice names your first board. The canvas starts empty so no sample content becomes part of your workspace.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {useCases.map((option) => (
                      <label
                        key={option.id}
                        className="flex cursor-pointer items-start gap-3 rounded-radius-xl bg-surface-white p-4 text-base ring-1 ring-border-subtle motion-safe:transition-transform motion-safe:duration-200 has-checked:-translate-y-0.5 has-checked:bg-sky-blue-accent/10 has-checked:ring-sky-blue-accent sm:text-sm"
                      >
                        <span className="flex h-lh items-center">
                          <input
                            type="radio"
                            name="use-case"
                            value={option.id}
                            checked={useCase === option.id}
                            onChange={() => setUseCase(option.id)}
                            className="size-5 shrink-0 accent-sky-blue-accent sm:size-4"
                          />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{option.title}</span>
                          <span className="text-dark-text-alt">{option.detail}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {step === 3 && (
                <section aria-labelledby="starter-step-heading" className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2">
                    <h1 id="starter-step-heading" className="text-balance text-3xl font-semibold tracking-tight">
                      Begin with a clean canvas
                    </h1>
                    <p className="max-w-[60ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                      Fabric creates an empty, private board. Add a template later from the whiteboard when it supports the work you are doing.
                    </p>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                      <p className="text-base font-medium sm:text-sm">
                        Choose a board theme
                      </p>
                      <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                        Grid is selected by default. You can change the shared theme from the board at any time.
                      </p>
                    </div>
                    <BoardThemeSelector
                      value={boardTheme}
                      onChange={setBoardTheme}
                      name="onboarding-board-theme"
                      legend="First board theme"
                      disabled={creationState === "creating"}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1 rounded-radius-xl bg-light-surface-tint p-4 ring-1 ring-border-subtle">
                      <p className="text-base font-medium sm:text-sm">
                        {selectedUseCase ? `${selectedUseCase} board` : "First board"}
                      </p>
                      <p className="text-base text-dark-text-alt sm:text-sm">
                        Empty board with no sample objects
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 rounded-radius-xl bg-light-surface-tint p-4 ring-1 ring-border-subtle">
                      <p className="text-base font-medium sm:text-sm">Private by default</p>
                      <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                        You will be the workspace owner. Add members only after the workspace is created.
                      </p>
                    </div>
                  </div>
                </section>
              )}

              <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-5">
                {step > 1 ? (
                  <Button type="button" tone="ghost" size="default" onClick={() => setStep((current) => current - 1)}>
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  type="submit"
                  tone="primary"
                  size="default"
                  disabled={creationState === "creating"}
                >
                  {creationState === "creating"
                    ? "Creating…"
                    : step === 3
                      ? "Create Workspace"
                      : "Continue"}
                </Button>
              </div>
              {creationState === "error" && (
                <p role="alert" className="text-base text-red-700 sm:text-sm">
                  {creationError}
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

function BoardPreviewPlaceholder({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-light-surface-tint" aria-hidden="true">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgb(18_18_18/8%)_1px,transparent_1px),linear-gradient(90deg,rgb(18_18_18/8%)_1px,transparent_1px)] [background-size:22px_22px]" />
      <p className="relative rounded-radius-pill bg-surface-white/90 px-3 py-1.5 font-mono text-sm text-muted-gray ring-1 ring-border-subtle backdrop-blur-sm">{label}</p>
    </div>
  );
}

export function WorkspaceDashboardPage({
  workspaceId,
  query = "",
}: {
  workspaceId?: string;
  query?: string;
}) {
  const router = useRouter();
  const [boards, setBoards] = useState<StoredBoardSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [creating, setCreating] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let active = true;

    void listWorkspaces()
      .then(async (workspaceResult) => {
        if (!active) return;
        const selectedWorkspace =
          workspaceResult.find((candidate) => candidate.id === workspaceId) ??
          workspaceResult[0] ??
          null;
        const boardResult = selectedWorkspace
          ? await listBoards({ workspaceId: selectedWorkspace.id, view: "recent" })
          : [];
        if (!active) return;
        setBoards(boardResult);
        setWorkspaces(workspaceResult);
        setLoadState("ready");
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [workspaceId]);

  const activeWorkspace =
    workspaces.find((candidate) => candidate.id === workspaceId) ?? workspaces[0] ?? null;
  const activeBoards = activeWorkspace
    ? boards.filter((board) => board.workspaceId === activeWorkspace.id && !board.archivedAt)
    : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleBoards = normalizedQuery
    ? activeBoards.filter((board) => board.title.toLocaleLowerCase().includes(normalizedQuery))
    : activeBoards;

  const handleCreateBoard = async () => {
    if (!activeWorkspace) {
      router.push(APP_ROUTES.workspaces);
      return;
    }

    setCreating(true);
    try {
      const board = await createBoardRequest({
        workspaceId: activeWorkspace.id,
        title: "Untitled board",
        document: { version: 1, nodes: [], edges: [] },
      });
      setBoards((current) => [board, ...current]);
      router.push(boardPath(board.id));
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "The board could not be created.");
      setCreating(false);
    }
  };

  return (
    <LegacyWorkspaceShell
      title="Boards"
      workspaceId={activeWorkspace?.id}
      workspaceName={activeWorkspace?.name}
      description={
        activeWorkspace
          ? `Open recent work in ${activeWorkspace.name}, or start a focused board.`
          : "Open recent work, review sync state, or start a focused board."
      }
      action={
        <Button
          tone="primary"
          size="default"
          leading={<PlusIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
          onClick={handleCreateBoard}
          disabled={creating || loadState === "loading"}
        >
          {creating ? "Creating…" : "Create Board"}
        </Button>
      }
    >
      <dl className="grid gap-y-5 sm:grid-cols-3 sm:gap-y-0 sm:divide-x sm:divide-border-subtle">
        {[
          ["Active boards", loadState === "ready" ? String(activeBoards.length) : "—"],
          ["Your role", activeWorkspace?.role ?? "—"],
          ["Workspace access", loadState === "ready" ? "Scoped" : "Checking"],
        ].map(([label, value], index) => (
          <div key={label} className={cx("flex flex-col gap-1", index === 0 ? "sm:pr-5" : "sm:px-5")}>
            <dt className="truncate text-base font-medium sm:text-sm">{label}</dt>
            <dd className="tabular-nums text-2xl font-medium text-dark-text-alt">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="recent-boards-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="recent-boards-heading" className="text-base font-semibold">
            Recent Boards
          </h2>
          <p className="text-base text-muted-gray sm:text-sm">Sorted by activity</p>
        </div>
        {loadState === "error" && (
          <div className="mt-4 rounded-radius-xl bg-red-50 p-4 text-base text-red-700 ring-1 ring-red-200 sm:text-sm">
            Boards could not be loaded. Refresh the page to retry.
          </div>
        )}
        {loadState === "ready" && visibleBoards.length === 0 && (
          <div className="mt-4 flex min-h-44 flex-col items-start justify-center gap-3 rounded-radius-xl bg-light-surface-tint p-5 ring-1 ring-border-subtle">
            <h3 className="text-base font-semibold">
              {normalizedQuery ? "No boards match this search" : "Start with a clean canvas"}
            </h3>
            <p className="max-w-[50ch] text-base text-dark-text-alt sm:text-sm">
              {normalizedQuery
                ? `No active board in this workspace contains “${query.trim()}” in its title.`
                : "This workspace has no active boards yet. Create one and invite collaborators when you are ready."}
            </p>
          </div>
        )}
        <ul role="list" className="grid gap-5 pt-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleBoards.map((board) => (
            <li key={board.id}>
              <div className="text-base sm:text-sm">
                <Link
                  href={boardPath(board.id)}
                  className="group flex flex-col outline-none motion-safe:transition-transform motion-safe:duration-200 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                >
                  <div className="relative aspect-[16/10] overflow-hidden rounded-[min(1vw,var(--radius-radius-lg))] bg-light-surface-tint outline-1 -outline-offset-1 outline-black/10">
                    <BoardPreviewPlaceholder label="Preview opens in editor" />
                    <p className="absolute right-3 bottom-3 rounded-radius-md bg-surface-white/90 px-2 py-1 text-[0.75rem] font-medium text-near-black-primary-text opacity-100 ring-1 ring-black/5 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">
                      Open Board
                    </p>
                  </div>
                  <span className="flex min-w-0 items-start justify-between gap-3 pt-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{board.title}</span>
                      <span className="truncate text-muted-gray">
                        Updated {new Date(board.updatedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </span>
                    <span className="size-2 shrink-0 rounded-radius-pill bg-sky-blue-accent" aria-label="Active board" />
                  </span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dashboard-activity-heading">
        <div className="flex items-center justify-between gap-4">
          <h2 id="dashboard-activity-heading" className="text-base font-semibold">
            Recent Activity
          </h2>
          <div className="text-base font-medium sm:text-sm">
            <Link
              href={workspaceRoutePath(APP_ROUTES.activity, activeWorkspace?.id)}
              className="text-dark-text-alt outline-none hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
            >
              View All
            </Link>
          </div>
        </div>
        <ul role="list" className="divide-y divide-border-subtle pt-3">
          {activeBoards.slice(0, 3).map((board) => (
            <li key={board.id} className="flex items-center gap-3 py-3.5">
              <div className="grid size-8 shrink-0 place-items-center rounded-radius-pill bg-slate-button-dark text-[0.6875rem] font-medium text-surface-white outline-1 -outline-offset-1 outline-black/10">
                {board.title.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-near-black-primary-text sm:text-sm">
                  {board.title} was updated
                </p>
                <p className="text-base text-muted-gray sm:text-sm">
                  {new Date(board.updatedAt).toLocaleString()}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <Toast message={toast.message} />
    </LegacyWorkspaceShell>
  );
}

const workspaceRoles = ["owner", "editor", "commenter", "viewer"] as const;

function roleLabel(role: WorkspaceRole): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function memberLabel(member: WorkspaceMember): string {
  return member.name?.trim() || member.email?.trim() || "Fabric member";
}

function memberErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof FabricApiError)) {
    return error instanceof Error ? error.message : fallback;
  }

  if (error.code === "last_owner") {
    return "The last owner cannot be demoted or removed. Promote another member to Owner first.";
  }
  if (error.code === "member_exists") {
    return "That account is already a workspace member. Review the current member list.";
  }
  if (error.code === "user_not_found") {
    return "No active Fabric account matches that email address. Ask them to sign in to Fabric once, then try again.";
  }
  if (error.code === "not_found") {
    return "This workspace or member is no longer available to you. Refresh your workspace list.";
  }
  if (error.status === 401) {
    return "Your session expired. Sign in again before changing workspace access.";
  }
  return error.message || fallback;
}

function useWorkspaceSelection(requestedWorkspaceId: string | undefined, routePath: string) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(requestedWorkspaceId);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;

    void listWorkspaces()
      .then((result) => {
        if (!active) return;
        setWorkspaces(result);
        const selected =
          result.find((workspace) => workspace.id === requestedWorkspaceId) ?? result[0];
        setSelectedWorkspaceId(selected?.id);
        setLoadState("ready");

        if (selected && selected.id !== requestedWorkspaceId) {
          router.replace(
            `${routePath}?workspaceId=${encodeURIComponent(selected.id)}`,
            { scroll: false },
          );
        }
      })
      .catch(() => {
        if (active) setLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [requestVersion, requestedWorkspaceId, routePath, router]);

  const selectWorkspace = (workspaceId: string) => {
    setSelectedWorkspaceId(workspaceId);
    router.replace(`${routePath}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      scroll: false,
    });
  };

  return {
    activeWorkspace:
      workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null,
    loadState,
    reloadWorkspaces: () => {
      setLoadState("loading");
      setRequestVersion((version) => version + 1);
    },
    selectWorkspace,
    selectedWorkspaceId,
    workspaces,
  };
}

function WorkspacePicker({
  workspaces,
  value,
  onChange,
}: {
  workspaces: WorkspaceSummary[];
  value?: string;
  onChange: (workspaceId: string) => void;
}) {
  return (
    <label htmlFor="active-workspace" className="flex min-w-0 flex-col gap-1 text-base font-medium sm:text-sm">
      <span className="text-muted-gray">Current Workspace</span>
      <span className="inline-grid min-w-52 grid-cols-[1fr_--spacing(8)]">
        <select
          id="active-workspace"
          name="active-workspace"
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value)}
          className={selectClass}
        >
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <ChevronDownIcon
          className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray"
          aria-hidden="true"
        />
      </span>
    </label>
  );
}

function RemoveMemberDialog({
  member,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  member: WorkspaceMember;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const name = memberLabel(member);

  useEffect(() => {
    cancelButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, pending]);

  return (
    <div className="fixed inset-0 z-200 grid place-items-center p-4">
      <button
        type="button"
        aria-label="Cancel Member Removal"
        className="modal-backdrop absolute inset-0"
        onClick={pending ? undefined : onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="remove-member-heading"
        aria-describedby="remove-member-description"
        className="floating-shadow panel-enter relative flex w-full max-w-md flex-col gap-5 rounded-radius-xl bg-surface-white p-5 ring-1 ring-black/5"
      >
        <div className="flex items-start gap-3">
          <ExclamationTriangleIcon
            className="size-4 shrink-0 fill-(--danger)"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <h2 id="remove-member-heading" className="text-balance text-lg font-semibold">
              Remove {name}?
            </h2>
            <p id="remove-member-description" className="text-pretty text-base text-dark-text-alt sm:text-sm">
              They will immediately lose access to every board in this workspace. Their existing board content remains in workspace history.
            </p>
          </div>
        </div>
        {error && (
          <p role="alert" className="rounded-radius-md bg-red-50 px-3 py-2 text-base text-red-700 ring-1 ring-red-200 sm:text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button ref={cancelButton} tone="secondary" onClick={onCancel} disabled={pending}>
            Keep Member
          </Button>
          <Button tone="danger" onClick={onConfirm} disabled={pending}>
            {pending ? "Removing..." : "Remove Member"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function MembersPage({
  workspaceId,
  organizationWorkspaceId,
}: {
  workspaceId?: string;
  organizationWorkspaceId: string | null;
}) {
  const router = useRouter();
  const currentUser = useCurrentUser();
  const {
    activeWorkspace,
    loadState: workspaceLoadState,
    reloadWorkspaces,
    selectWorkspace,
    selectedWorkspaceId,
    workspaces,
  } = useWorkspaceSelection(workspaceId, APP_ROUTES.members);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [memberLoadState, setMemberLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [memberResponseWorkspaceId, setMemberResponseWorkspaceId] = useState<string | null>(null);
  const [memberRequestVersion, setMemberRequestVersion] = useState(0);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<WorkspaceRole>("viewer");
  const [adding, setAdding] = useState(false);
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const [formError, setFormError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);
  const [removeError, setRemoveError] = useState("");

  useEffect(() => {
    if (!selectedWorkspaceId) return;

    let active = true;

    void listWorkspaceMembers(selectedWorkspaceId)
      .then((result) => {
        if (!active) return;
        setMembers(result);
        setMemberResponseWorkspaceId(selectedWorkspaceId);
        setPageError("");
        setMemberLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMemberResponseWorkspaceId(selectedWorkspaceId);
        setPageError(memberErrorMessage(error, "Workspace members could not be loaded. Refresh the list and try again."));
        setMemberLoadState("error");
      });

    return () => {
      active = false;
    };
  }, [memberRequestVersion, selectedWorkspaceId]);

  const canManageMembers = activeWorkspace?.role === "owner";
  const visibleMemberLoadState =
    selectedWorkspaceId && memberResponseWorkspaceId === selectedWorkspaceId
      ? memberLoadState
      : "loading";

  const addMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedWorkspaceId || !email.trim()) return;

    setAdding(true);
    setFormError("");
    setPageError("");
    setStatusMessage("");
    try {
      const member = await addWorkspaceMemberRequest({
        workspaceId: selectedWorkspaceId,
        email,
        role: newRole,
      });
      setMembers((current) => [...current, member]);
      setEmail("");
      setNewRole("viewer");
      setStatusMessage(`Added ${memberLabel(member)} as ${roleLabel(member.role)}`);
    } catch (error) {
      setFormError(memberErrorMessage(error, "The member could not be added. Check the email address and try again."));
    } finally {
      setAdding(false);
    }
  };

  const changeRole = async (member: WorkspaceMember, role: WorkspaceRole) => {
    if (!selectedWorkspaceId || role === member.role) return;
    setPendingMemberId(member.userId);
    setPageError("");
    setStatusMessage("");
    try {
      const updated = await updateWorkspaceMemberRequest({
        workspaceId: selectedWorkspaceId,
        userId: member.userId,
        role,
      });
      setMembers((current) =>
        current.map((candidate) =>
          candidate.userId === member.userId
            ? { ...candidate, role: updated.role }
            : candidate,
        ),
      );
      setStatusMessage(`Changed ${memberLabel(member)} to ${roleLabel(updated.role)}`);

      if (member.userId === currentUser.id) {
        reloadWorkspaces();
        setMemberLoadState("loading");
        setMemberRequestVersion((version) => version + 1);
      }
    } catch (error) {
      setPageError(memberErrorMessage(error, "The member role could not be changed. Refresh the list and try again."));
    } finally {
      setPendingMemberId(null);
    }
  };

  const removeMember = async () => {
    if (!selectedWorkspaceId || !memberToRemove) return;
    setPendingMemberId(memberToRemove.userId);
    setRemoveError("");
    setStatusMessage("");
    try {
      await removeWorkspaceMemberRequest({
        workspaceId: selectedWorkspaceId,
        userId: memberToRemove.userId,
      });
      const removed = memberToRemove;
      setMembers((current) => current.filter((member) => member.userId !== removed.userId));
      setMemberToRemove(null);
      setStatusMessage(`Removed ${memberLabel(removed)} from the workspace`);

      if (removed.userId === currentUser.id) {
        router.push("/app");
      }
    } catch (error) {
      setRemoveError(memberErrorMessage(error, "The member could not be removed. Refresh the list and try again."));
    } finally {
      setPendingMemberId(null);
    }
  };

  const picker = workspaces.length > 0 ? (
    <WorkspacePicker
      workspaces={workspaces}
      value={selectedWorkspaceId}
      onChange={(nextWorkspaceId) => {
        setPageError("");
        setFormError("");
        setStatusMessage("");
        selectWorkspace(nextWorkspaceId);
      }}
    />
  ) : undefined;

  return (
    <SharedWorkspaceShell
      title="Members"
      description={
        activeWorkspace
          ? `Manage durable access to ${activeWorkspace.name}.`
          : "Manage durable workspace access and member roles."
      }
      action={picker}
      workspaceId={selectedWorkspaceId}
      workspaceName={activeWorkspace?.name}
    >
      {workspaceLoadState === "loading" && (
        <div className="min-h-32 animate-pulse rounded-radius-xl bg-light-surface-tint ring-1 ring-border-subtle motion-reduce:animate-none" aria-label="Loading workspace members" />
      )}

      {workspaceLoadState === "error" && (
        <div className="flex min-h-32 flex-col items-start justify-center gap-3 rounded-radius-xl bg-red-50 p-5 ring-1 ring-red-200">
          <p className="text-pretty text-base text-red-700 sm:text-sm">
            Workspaces could not be loaded. Refresh the workspace list and try again.
          </p>
          <Button tone="secondary" onClick={reloadWorkspaces}>Refresh Workspaces</Button>
        </div>
      )}

      {workspaceLoadState === "ready" && !activeWorkspace && (
        <div className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-radius-xl bg-light-surface-tint p-5 ring-1 ring-border-subtle">
          <h2 className="text-base font-semibold">Create a workspace first</h2>
          <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
            Members are attached to a workspace. Create one to start collaborating.
          </p>
          <PrimaryLink href={APP_ROUTES.workspaces}>Open Workspaces</PrimaryLink>
        </div>
      )}

      {activeWorkspace && (
        <>
          {canManageMembers ? (
            <section aria-labelledby="add-member-heading" className="border-b border-border-subtle pb-8">
              <div className="grid gap-5 lg:grid-cols-[2fr_3fr] lg:items-end">
                <div className="flex flex-col gap-1">
                  <h2 id="add-member-heading" className="text-base font-semibold">Add a Member</h2>
                  <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                    Add someone after they have signed in to Fabric at least once.
                  </p>
                </div>
                <form onSubmit={addMember} className="flex flex-col gap-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
                    <label htmlFor="add-member-email" className="flex min-w-0 flex-col gap-2 text-base font-medium sm:text-sm">
                      <span>Email Address</span>
                      <input
                        id="add-member-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="teammate@example.com"
                        required
                        disabled={adding}
                        className={fieldClass}
                      />
                    </label>
                    <label htmlFor="add-member-role" className="flex min-w-0 flex-col gap-2 text-base font-medium sm:text-sm">
                      <span>Role</span>
                      <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                        <select
                          id="add-member-role"
                          name="role"
                          value={newRole}
                          onChange={(event) => setNewRole(event.target.value as WorkspaceRole)}
                          disabled={adding}
                          className={selectClass}
                        >
                          {workspaceRoles.map((role) => (
                            <option key={role} value={role}>{roleLabel(role)}</option>
                          ))}
                        </select>
                        <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
                      </span>
                    </label>
                    <Button
                      type="submit"
                      tone="primary"
                      size="default"
                      disabled={adding}
                      leading={<EnvelopeIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />}
                    >
                      {adding ? "Adding..." : "Add Member"}
                    </Button>
                  </div>
                  {formError && <p role="alert" className="text-pretty text-base text-red-700 sm:text-sm">{formError}</p>}
                </form>
              </div>
            </section>
          ) : (
            <div className="rounded-radius-lg bg-light-surface-tint px-4 py-3 ring-1 ring-border-subtle">
              <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                Your {roleLabel(activeWorkspace.role)} role can view members. Only workspace owners can add, remove, or change member access.
              </p>
            </div>
          )}

          {(pageError || statusMessage) && (
            <div
              role={pageError ? "alert" : "status"}
              className={cx(
                "rounded-radius-lg px-3 py-2 text-base ring-1 sm:text-sm",
                pageError
                  ? "bg-red-50 text-red-700 ring-red-200"
                  : "bg-sky-blue-accent/10 text-sky-blue-accent ring-sky-blue-accent/20",
              )}
            >
              {pageError || statusMessage}
            </div>
          )}

          <section aria-labelledby="member-list-heading">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div className="flex flex-col gap-1">
                <h2 id="member-list-heading" className="text-base font-semibold">Workspace Members</h2>
                <p className="text-base text-muted-gray sm:text-sm">
                  {visibleMemberLoadState === "ready" ? `${members.length} ${members.length === 1 ? "member" : "members"}` : "Loading members"}
                </p>
              </div>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                Every workspace must keep at least one owner.
              </p>
            </div>

            {visibleMemberLoadState === "loading" && (
              <div className="flex flex-col gap-3 pt-5" aria-label="Loading members">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-14 animate-pulse rounded-radius-md bg-light-surface-tint motion-reduce:animate-none" />
                ))}
              </div>
            )}

            {visibleMemberLoadState === "error" && (
              <div className="flex items-center gap-3 pt-5">
                <Button tone="secondary" onClick={() => {
                  setMemberLoadState("loading");
                  setMemberRequestVersion((version) => version + 1);
                }}>
                  Refresh Members
                </Button>
              </div>
            )}

            {visibleMemberLoadState === "ready" && (
              <div className="-mx-4 -my-2 overflow-x-auto whitespace-nowrap pt-5 sm:-mx-6 lg:-mx-8">
                <div className="inline-block min-w-full px-4 py-2 align-middle sm:px-6 lg:px-8">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border-subtle text-left">
                        <th scope="col" className="whitespace-nowrap py-2 pr-5 text-base font-medium text-muted-gray sm:text-sm">Member</th>
                        <th scope="col" className="whitespace-nowrap px-5 py-2 text-base font-medium text-muted-gray sm:text-sm">Role</th>
                        <th scope="col" className="whitespace-nowrap px-5 py-2 text-base font-medium text-muted-gray sm:text-sm">Joined</th>
                        <th scope="col" className="whitespace-nowrap py-2 pl-5"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {members.map((member) => {
                        const name = memberLabel(member);
                        const pending = pendingMemberId === member.userId;
                        return (
                          <tr key={member.userId}>
                            <td className="py-3.5 pr-5">
                              <div className="flex min-w-0 items-center gap-3">
                                <UserAvatar user={member} size="medium" />
                                <div className="min-w-0">
                                  <p className="text-base font-medium sm:text-sm">
                                    {name}{member.userId === currentUser.id ? " (You)" : ""}
                                  </p>
                                  <p className="text-base text-muted-gray sm:text-sm">
                                    {member.email || "Email visible to workspace owners"}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3.5">
                              <label>
                                <span className="sr-only">Role for {name}</span>
                                <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
                                  <select
                                    name={`role-${member.userId}`}
                                    value={member.role}
                                    onChange={(event) => void changeRole(member, event.target.value as WorkspaceRole)}
                                    disabled={!canManageMembers || pending}
                                    className="col-span-full row-start-1 h-10 appearance-none rounded-radius-md bg-surface-white pr-8 pl-2 text-base outline-none ring-1 ring-border-subtle disabled:bg-light-surface-tint disabled:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm"
                                  >
                                    {workspaceRoles.map((role) => (
                                      <option key={role} value={role}>{roleLabel(role)}</option>
                                    ))}
                                  </select>
                                  <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
                                </span>
                              </label>
                            </td>
                            <td className="px-5 py-3.5">
                              <p className="tabular-nums text-base text-dark-text-alt sm:text-sm">
                                {new Date(member.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })}
                              </p>
                            </td>
                            <td className="py-3.5 pl-5 text-right">
                              {canManageMembers && (
                                <IconButton
                                  label={`Remove ${name}`}
                                  disabled={pending}
                                  onClick={() => {
                                    setRemoveError("");
                                    setMemberToRemove(member);
                                  }}
                                >
                                  <TrashIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                                </IconButton>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {organizationWorkspaceId === activeWorkspace.id ? (
            <ProjectMembersPanel
              key={activeWorkspace.id}
              workspaceId={activeWorkspace.id}
              canManage={canManageMembers}
            />
          ) : null}
        </>
      )}

      {memberToRemove && (
        <RemoveMemberDialog
          member={memberToRemove}
          pending={pendingMemberId === memberToRemove.userId}
          error={removeError}
          onCancel={() => {
            setRemoveError("");
            setMemberToRemove(null);
          }}
          onConfirm={() => void removeMember()}
        />
      )}
    </SharedWorkspaceShell>
  );
}

function ReadOnlySetting({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status: string;
}) {
  return (
    <div className="flex items-start justify-between gap-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium sm:text-sm">{title}</p>
        <p className="max-w-[62ch] text-pretty text-base text-dark-text-alt sm:text-sm">{description}</p>
      </div>
      <p className="shrink-0 text-base sm:text-sm">
        <span className="rounded-radius-pill bg-light-surface-tint px-2 py-1 font-medium text-dark-text-alt ring-1 ring-border-subtle">
          {status}
        </span>
      </p>
    </div>
  );
}

function DeleteWorkspaceDialog({
  workspace,
  deleting,
  error,
  onClose,
  onDelete,
}: {
  workspace: WorkspaceSummary | null;
  deleting: boolean;
  error: string | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  if (!workspace) return null;

  const confirmed = confirmation === workspace.name;
  return (
    <FabricDialog
      open
      title="Delete workspace"
      description="Every board in this workspace will be removed for every member. This cannot be undone in Fabric."
      onClose={() => {
        if (!deleting) onClose();
      }}
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (confirmed && !deleting) onDelete();
        }}
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor="delete-workspace-confirmation"
            className="text-base font-medium sm:text-sm"
          >
            Type <strong className="font-semibold">{workspace.name}</strong> to confirm
          </label>
          <input
            id="delete-workspace-confirmation"
            name="delete-workspace-confirmation"
            type="text"
            autoComplete="off"
            value={confirmation}
            disabled={deleting}
            onChange={(event) => setConfirmation(event.target.value)}
            className="h-11 rounded-radius-md bg-surface-white px-3 text-base ring-1 ring-near-black-primary-text/10 outline-none focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-[var(--danger)] disabled:opacity-45 sm:h-9 sm:text-sm"
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-radius-md bg-[var(--danger-soft)] px-3 py-2 text-base text-[var(--danger)] ring-1 ring-[var(--danger-border)] sm:text-sm"
          >
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2 border-t border-near-black-primary-text/8 pt-4">
          <Button type="button" tone="ghost" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button
            type="submit"
            tone="danger"
            disabled={!confirmed || deleting}
            leading={
              <TrashIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
            }
          >
            {deleting ? "Deleting…" : "Delete workspace"}
          </Button>
        </div>
      </form>
    </FabricDialog>
  );
}

export function SettingsPage({ workspaceId }: { workspaceId?: string }) {
  const router = useRouter();
  const {
    activeWorkspace,
    loadState,
    reloadWorkspaces,
    selectWorkspace,
    selectedWorkspaceId,
    workspaces,
  } = useWorkspaceSelection(workspaceId, APP_ROUTES.settings);
  const [workspaceToDelete, setWorkspaceToDelete] =
    useState<WorkspaceSummary | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteWorkspace = async () => {
    if (!workspaceToDelete) return;
    setDeletingWorkspace(true);
    setDeleteError(null);
    try {
      await deleteWorkspaceRequest({
        workspaceId: workspaceToDelete.id,
        expectedName: workspaceToDelete.name,
      });
      router.replace(APP_ROUTES.workspaces);
    } catch (error) {
      setDeleteError(
        error instanceof Error
          ? error.message
          : "The workspace could not be deleted.",
      );
      setDeletingWorkspace(false);
    }
  };

  return (
    <SharedWorkspaceShell
      title="Workspace Settings"
      description={
        activeWorkspace
          ? `Review access and collaboration settings for ${activeWorkspace.name}.`
          : "Review workspace access and collaboration settings."
      }
      action={
        workspaces.length > 0 ? (
          <WorkspacePicker
            workspaces={workspaces}
            value={selectedWorkspaceId}
            onChange={selectWorkspace}
          />
        ) : undefined
      }
      workspaceId={selectedWorkspaceId}
      workspaceName={activeWorkspace?.name}
    >
      {loadState === "loading" && (
        <div className="min-h-32 animate-pulse rounded-radius-xl bg-light-surface-tint ring-1 ring-border-subtle motion-reduce:animate-none" aria-label="Loading workspace policy" />
      )}

      {loadState === "error" && (
        <div className="flex min-h-32 flex-col items-start justify-center gap-3 rounded-radius-xl bg-red-50 p-5 ring-1 ring-red-200">
          <p className="text-pretty text-base text-red-700 sm:text-sm">
            Workspace policy could not be loaded. Refresh the workspace list and try again.
          </p>
          <Button tone="secondary" onClick={reloadWorkspaces}>Refresh Workspaces</Button>
        </div>
      )}

      {loadState === "ready" && !activeWorkspace && (
        <div className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-radius-xl bg-light-surface-tint p-5 ring-1 ring-border-subtle">
          <h2 className="text-base font-semibold">No workspace settings yet</h2>
          <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
            Create a workspace before reviewing its access and collaboration policy.
          </p>
          <PrimaryLink href={APP_ROUTES.workspaces}>Open Workspaces</PrimaryLink>
        </div>
      )}

      {activeWorkspace && (
        <>
          <section aria-labelledby="general-settings-heading" className="grid gap-6 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-1">
              <h2 id="general-settings-heading" className="text-base font-semibold">Workspace</h2>
              <p className="text-pretty text-base text-dark-text-alt sm:text-sm">Workspace identity and your access level.</p>
            </div>
            <dl>
              <div className="grid gap-1 pb-4 sm:grid-cols-[10rem_1fr] sm:gap-5">
                <dt className="text-base font-medium sm:text-sm">Workspace Name</dt>
                <dd className="text-base text-dark-text-alt sm:text-sm">{activeWorkspace.name}</dd>
              </div>
              <div className="grid gap-1 border-t border-near-black-primary-text/8 pt-4 sm:grid-cols-[10rem_1fr] sm:gap-5">
                <dt className="text-base font-medium sm:text-sm">Your Role</dt>
                <dd className="text-base text-dark-text-alt sm:text-sm">{roleLabel(activeWorkspace.role)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="collaboration-settings-heading" className="grid gap-6 border-t border-border-subtle pt-8 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col items-start gap-3">
              <div className="flex flex-col gap-1">
                <h2 id="collaboration-settings-heading" className="text-base font-semibold">Collaboration</h2>
                <p className="text-pretty text-base text-dark-text-alt sm:text-sm">What your role can manage in this workspace.</p>
              </div>
              <div className="text-base font-medium sm:text-sm">
                <Link
                  href={workspaceRoutePath(APP_ROUTES.members, activeWorkspace.id)}
                  className="inline-flex h-8 items-center rounded-radius-md bg-surface-white px-2.5 text-near-black-primary-text ring-1 ring-border-subtle outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                >
                  View Members
                </Link>
              </div>
            </div>
            <div className="divide-y divide-border-subtle">
              <ReadOnlySetting
                title="Member Administration"
                description="Owners can add existing Fabric accounts, change roles, and remove access."
                status={activeWorkspace.role === "owner" ? "Available" : "Owner Only"}
              />
              <ReadOnlySetting
                title="Board Share Links"
                description="Board owners and workspace owners can create revocable viewer or commenter links."
                status="Per Board"
              />
              <ReadOnlySetting
                title="Live Presence"
                description={
                  realtimeConfigured
                    ? "Collaborators can see who is online and follow live cursors on a board."
                    : "Online collaborators and live cursors are unavailable right now."
                }
                status={realtimeConfigured ? "Available" : "Unavailable"}
              />
            </div>
          </section>

          <section aria-labelledby="ai-settings-heading" className="grid gap-6 border-t border-border-subtle pt-8 lg:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-1">
              <h2 id="ai-settings-heading" className="text-base font-semibold">Fabric Agent</h2>
              <p className="text-pretty text-base text-dark-text-alt sm:text-sm">How agent suggestions become board changes.</p>
            </div>
            <div className="divide-y divide-border-subtle">
              <ReadOnlySetting
                title="Streaming Responses"
                description="Fabric agent shows progress while it prepares a suggestion."
                status="On"
              />
              <ReadOnlySetting
                title="Human Approval"
                description="An authorized editor reviews every suggestion before it changes the board."
                status="Required"
              />
              <ReadOnlySetting
                title="Other Boards"
                description="Fabric agent uses the current board and does not read other workspace boards."
                status="Off"
              />
            </div>
          </section>

          {activeWorkspace.role === "owner" ? (
            <section
              aria-labelledby="danger-zone-heading"
              className="grid gap-6 border-t border-[var(--danger-border)] pt-8 lg:grid-cols-[1fr_2fr]"
            >
              <div className="flex flex-col gap-1">
                <h2 id="danger-zone-heading" className="text-base font-semibold">
                  Danger Zone
                </h2>
                <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                  Destructive workspace actions are limited to owners.
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 rounded-radius-xl bg-[var(--danger-soft)] p-4 ring-1 ring-[var(--danger-border)]">
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold">Delete this workspace</h3>
                  <p className="max-w-[62ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                    Remove this workspace and all of its boards for every member.
                  </p>
                </div>
                {deleteError ? (
                  <p role="alert" className="text-base text-[var(--danger)] sm:text-sm">
                    {deleteError}
                  </p>
                ) : null}
                <Button
                  tone="danger"
                  leading={
                    <TrashIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
                  }
                  onClick={() => {
                    setDeleteError(null);
                    setWorkspaceToDelete(activeWorkspace);
                  }}
                >
                  Delete workspace
                </Button>
              </div>
            </section>
          ) : null}
        </>
      )}
      <DeleteWorkspaceDialog
        key={workspaceToDelete?.id ?? "closed"}
        workspace={workspaceToDelete}
        deleting={deletingWorkspace}
        error={deleteError}
        onClose={() => {
          setWorkspaceToDelete(null);
          setDeleteError(null);
        }}
        onDelete={() => void handleDeleteWorkspace()}
      />
    </SharedWorkspaceShell>
  );
}

function activityDayLabel(occurredAt: string): string {
  const date = new Date(occurredAt);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const startOfActivityDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round(
    (startOfToday.getTime() - startOfActivityDay.getTime()) / 86_400_000,
  );
  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

export function ActivityPage({ workspaceId }: { workspaceId?: string }) {
  const [filter, setFilter] = useState("All activity");
  const {
    activeWorkspace,
    loadState: workspaceLoadState,
    reloadWorkspaces,
    selectWorkspace,
    selectedWorkspaceId,
    workspaces,
  } = useWorkspaceSelection(workspaceId, APP_ROUTES.activity);
  const [items, setItems] = useState<WorkspaceActivityItem[]>([]);
  const [activityLoadState, setActivityLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [responseWorkspaceId, setResponseWorkspaceId] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [activityRequestVersion, setActivityRequestVersion] = useState(0);

  useEffect(() => {
    if (!selectedWorkspaceId) return;
    const controller = new AbortController();

    void listWorkspaceActivity({ workspaceId: selectedWorkspaceId, limit: 30 })
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        setResponseWorkspaceId(selectedWorkspaceId);
        setActivityLoadState("ready");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setResponseWorkspaceId(selectedWorkspaceId);
        setActivityLoadState("error");
      });

    return () => controller.abort();
  }, [activityRequestVersion, selectedWorkspaceId]);

  const visibleActivityLoadState =
    selectedWorkspaceId && responseWorkspaceId === selectedWorkspaceId
      ? activityLoadState
      : "loading";
  const filtered = useMemo(
    () => items.filter((item) => filter === "All activity" || item.type === filter),
    [filter, items],
  );
  const grouped = useMemo(() => {
    const groups = new Map<string, WorkspaceActivityItem[]>();
    for (const item of filtered) {
      const label = activityDayLabel(item.occurredAt);
      groups.set(label, [...(groups.get(label) ?? []), item]);
    }
    return [...groups.entries()];
  }, [filtered]);

  const loadEarlier = async () => {
    if (!selectedWorkspaceId || !nextCursor || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await listWorkspaceActivity({
        workspaceId: selectedWorkspaceId,
        cursor: nextCursor,
        limit: 30,
      });
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingEarlier(false);
    }
  };

  return (
    <SharedWorkspaceShell
      title="Activity"
      workspaceId={selectedWorkspaceId}
      workspaceName={activeWorkspace?.name}
      description={
        activeWorkspace
          ? `Review durable board, comment, and member events in ${activeWorkspace.name}.`
          : "Review durable board, comment, and member events."
      }
      action={
        workspaces.length > 0 ? (
          <WorkspacePicker
            workspaces={workspaces}
            value={selectedWorkspaceId}
            onChange={selectWorkspace}
          />
        ) : undefined
      }
    >
      <section aria-labelledby="activity-stream-heading">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1">
            <h2 id="activity-stream-heading" className="text-base font-semibold">Workspace Activity</h2>
            <p className="text-base text-muted-gray sm:text-sm">Times are shown in your local timezone.</p>
          </div>
          <label htmlFor="activity-filter" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
            <span>Filter Activity</span>
            <span className="inline-grid grid-cols-[1fr_--spacing(8)]">
              <select id="activity-filter" name="activity-filter" value={filter} onChange={(event) => setFilter(event.target.value)} className={selectClass}>
                <option>All activity</option>
                <option>Boards</option>
                <option>Comments</option>
                <option>Members</option>
              </select>
              <ChevronDownIcon className="pointer-events-none col-start-2 row-start-1 size-4 shrink-0 place-self-center fill-muted-gray" aria-hidden="true" />
            </span>
          </label>
        </div>

        {workspaceLoadState === "error" && (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-radius-xl bg-red-50 p-4 text-base text-red-700 ring-1 ring-red-200 sm:text-sm">
            <p>Workspaces could not be loaded. Check your connection and try again.</p>
            <Button tone="secondary" onClick={reloadWorkspaces}>Retry</Button>
          </div>
        )}

        {visibleActivityLoadState === "loading" && (
          <p role="status" className="pt-8 text-base text-muted-gray sm:text-sm">Loading workspace activity…</p>
        )}

        {visibleActivityLoadState === "error" && (
          <div className="mt-6 flex flex-col items-start gap-3 rounded-radius-xl bg-red-50 p-4 text-base text-red-700 ring-1 ring-red-200 sm:text-sm">
            <p>Activity could not be loaded. Your workspace data was not changed.</p>
            <Button
              tone="secondary"
              onClick={() => {
                setActivityLoadState("loading");
                setActivityRequestVersion((version) => version + 1);
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {visibleActivityLoadState === "ready" && grouped.length > 0 ? (
          <div className="flex flex-col gap-8 pt-7">
            {grouped.map(([day, dayItems]) => (
                <section key={day} aria-labelledby={`activity-${day.toLowerCase()}-heading`}>
                  <h3 id={`activity-${day.toLowerCase()}-heading`} className="text-base font-semibold">{day}</h3>
                  <ol role="list" className="divide-y divide-border-subtle pt-2">
                    {dayItems.map((item) => (
                      <li key={item.id} className="grid gap-3 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-start">
                        <UserAvatar
                          user={{ name: item.actorName ?? item.type, email: null, image: item.actorImage }}
                          size="medium"
                        />
                        <div className="min-w-0">
                          <p className="text-pretty text-base sm:text-sm">
                            {item.actorName ? <><strong className="font-medium">{item.actorName}</strong>{" "}</> : null}
                            {item.action}{" "}
                            <Link
                              href={item.targetHref}
                              className="font-medium text-sky-blue-accent outline-none hover:underline focus-visible:outline-2 focus-visible:outline-sky-blue-accent"
                            >
                              {item.target}
                            </Link>
                          </p>
                          <p className="text-base text-muted-gray sm:text-sm">{item.type}</p>
                        </div>
                        <time dateTime={item.occurredAt} className="tabular-nums text-base text-muted-gray sm:text-sm">
                          {new Date(item.occurredAt).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </li>
                    ))}
                  </ol>
                </section>
            ))}
          </div>
        ) : visibleActivityLoadState === "ready" ? (
          <div className="pt-8">
            <p className="text-base text-dark-text-alt sm:text-sm">
              {items.length === 0
                ? "No durable activity has been recorded in this workspace yet."
                : "No activity matches this filter. Choose another activity type."}
            </p>
          </div>
        ) : null}

        {visibleActivityLoadState === "ready" && nextCursor && (
          <div className="flex justify-center border-t border-border-subtle pt-5">
            <Button tone="secondary" onClick={loadEarlier} disabled={loadingEarlier}>
              {loadingEarlier ? "Loading…" : "Load Earlier Activity"}
            </Button>
          </div>
        )}
      </section>
    </SharedWorkspaceShell>
  );
}

export function AccountPage() {
  const user = useCurrentUser();
  const initials = getUserInitials(user);
  const [profileState, profileAction, profilePending] = useActionState(
    updateCurrentProfile,
    initialProfileActionState,
  );
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "error">("loading");
  const [sessionsError, setSessionsError] = useState("");
  const [sessionsRequestVersion, setSessionsRequestVersion] = useState(0);
  const [currentSessionVerified, setCurrentSessionVerified] = useState(false);
  const [sessionToRevoke, setSessionToRevoke] = useState<AccountSession | null>(null);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [sessionAnnouncement, setSessionAnnouncement] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    void listAccountSessionsRequest(controller.signal)
      .then((result) => {
        setSessions(result.sessions);
        setCurrentSessionVerified(result.currentSessionVerified);
        setSessionsState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSessionsError(
          error instanceof Error
            ? error.message
            : "Sessions could not be loaded. Refresh the page and try again.",
        );
        setSessionsState("error");
      });

    return () => controller.abort();
  }, [sessionsRequestVersion]);

  const formatSessionDate = (value: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));

  const revokeSession = async (session: AccountSession) => {
    setRevokingSessionId(session.id);
    setSessionsError("");

    try {
      await revokeAccountSessionRequest(session.id);
      setSessions((currentSessions) =>
        currentSessions.filter((currentSession) => currentSession.id !== session.id),
      );
      setSessionToRevoke(null);
      setSessionAnnouncement(`${session.deviceLabel} session revoked.`);
    } catch (error) {
      setSessionsError(
        error instanceof Error
          ? error.message
          : "The session was not revoked. Refresh the list and try again.",
      );
    } finally {
      setRevokingSessionId(null);
    }
  };

  return (
    <SharedWorkspaceShell
      eyebrow="Personal"
      title="Account"
      description="Manage your profile and signed-in sessions."
      action={
        <Button
          type="submit"
          form="account-settings"
          tone="primary"
          size="default"
          disabled={profilePending}
          className="min-h-12 sm:min-h-0"
        >
          {profilePending ? "Saving..." : "Save Profile"}
        </Button>
      }
    >
      {profileState.status !== "idle" && (
        <div
          role="status"
          className={cx(
            "rounded-radius-lg px-3 py-2 text-base ring-1 sm:text-sm",
            profileState.status === "success"
              ? "bg-sky-blue-accent/10 text-sky-blue-accent ring-sky-blue-accent/20"
              : "bg-red-50 text-red-700 ring-red-200",
          )}
        >
          {profileState.message}
        </div>
      )}

      <form id="account-settings" action={profileAction} className="flex flex-col gap-10">
        <section aria-labelledby="profile-heading" className="grid gap-6 lg:grid-cols-[1fr_2fr]">
          <div className="flex flex-col gap-1">
            <h2 id="profile-heading" className="text-base font-semibold">Profile</h2>
            <p className="text-pretty text-base text-dark-text-alt sm:text-sm">This information appears beside comments and live presence.</p>
          </div>
          <div className="flex flex-col gap-6">
            <div className="flex items-center gap-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-radius-pill bg-slate-button-dark text-sm font-medium text-surface-white outline-1 -outline-offset-1 outline-black/10">{initials}</div>
              <div className="min-w-0">
                <p className="text-base font-medium sm:text-sm">Provider-Managed Avatar</p>
                <p className="max-w-[54ch] text-pretty text-base text-muted-gray sm:text-sm">
                  Your avatar comes from your connected sign-in provider and refreshes after you sign in again.
                </p>
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label htmlFor="account-name" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
                <span>Display Name</span>
                <input id="account-name" name="display-name" defaultValue={user.name ?? ""} className={fieldClass} />
              </label>
              <label htmlFor="account-email" className="flex flex-col gap-2 text-base font-medium sm:text-sm">
                <span>Email Address</span>
                <input
                  id="account-email"
                  name="email"
                  type="email"
                  defaultValue={user.email ?? ""}
                  readOnly
                  aria-describedby="account-email-description"
                  className={cx(fieldClass, "bg-light-surface-tint")}
                />
                <span id="account-email-description" className="font-normal text-muted-gray">
                  Managed by your connected sign-in provider.
                </span>
              </label>
            </div>
          </div>
        </section>
      </form>

      <section aria-labelledby="sessions-heading" className="grid gap-6 border-t border-border-subtle pt-8 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-1">
          <h2 id="sessions-heading" className="text-base font-semibold">Sessions</h2>
          <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
            Review active browser sessions and revoke access you no longer recognize.
          </p>
        </div>
        <div className="min-w-0" aria-live="polite">
          <p className="sr-only">{sessionAnnouncement}</p>

          {sessionsState === "loading" && (
            <div className="rounded-radius-lg bg-light-surface-tint px-4 py-5 ring-1 ring-border-subtle">
              <p className="text-base text-dark-text-alt sm:text-sm">Loading sessions...</p>
            </div>
          )}

          {sessionsState === "error" && (
            <div role="alert" className="flex flex-col items-start gap-3 rounded-radius-lg bg-red-50 px-4 py-4 ring-1 ring-red-200">
              <p className="text-pretty text-base text-red-700 sm:text-sm">{sessionsError}</p>
              <Button
                tone="secondary"
                className="min-h-12 sm:min-h-0"
                onClick={() => {
                  setSessionsState("loading");
                  setSessionsError("");
                  setSessionsRequestVersion((version) => version + 1);
                }}
              >
                Retry Session List
              </Button>
            </div>
          )}

          {sessionsState === "ready" && sessions.length === 0 && (
            <div className="rounded-radius-lg bg-light-surface-tint px-4 py-5 ring-1 ring-border-subtle">
              <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                No active sessions were returned. Sign out and sign in again to create a fresh session.
              </p>
            </div>
          )}

          {sessionsState === "ready" && sessions.length > 0 && (
            <div className="flex flex-col gap-4">
              {!currentSessionVerified && (
                <div role="alert" className="rounded-radius-lg bg-red-50 px-3 py-3 ring-1 ring-red-200">
                  <p className="text-pretty text-base text-red-700 sm:text-sm">
                    This browser could not be verified. Sign out and back in before revoking another session.
                  </p>
                </div>
              )}

              {sessionsError && (
                <div role="alert" className="rounded-radius-lg bg-red-50 px-3 py-3 ring-1 ring-red-200">
                  <p className="text-pretty text-base text-red-700 sm:text-sm">{sessionsError}</p>
                </div>
              )}

              <ul role="list" className="divide-y divide-border-subtle">
                {sessions.map((session, index) => {
                  const activityDate = session.lastSeenAt ?? session.createdAt;
                  const confirmationOpen = sessionToRevoke?.id === session.id;
                  const revoking = revokingSessionId === session.id;

                  return (
                    <li
                      key={session.id}
                      className={
                        index === 0
                          ? sessions.length === 1
                            ? undefined
                            : "pb-4"
                          : index === sessions.length - 1
                            ? "pt-4"
                            : "py-4"
                      }
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                        <div className="min-w-0">
                          <p className="text-base font-medium sm:text-sm">{session.deviceLabel}</p>
                          <p className="text-pretty text-base text-dark-text-alt sm:text-sm">
                            {activityDate
                              ? `Last active ${formatSessionDate(activityDate)}`
                              : `Expires ${formatSessionDate(session.expiresAt)}`}
                          </p>
                          {activityDate && (
                            <p className="text-pretty text-base text-muted-gray sm:text-sm">
                              Expires {formatSessionDate(session.expiresAt)}
                            </p>
                          )}
                        </div>

                        {session.current ? (
                          <p className="shrink-0 text-base sm:text-sm">
                            <span className="rounded-radius-pill bg-sky-blue-accent/10 px-2 py-1 font-medium text-sky-blue-accent">
                              Current
                            </span>
                          </p>
                        ) : (
                          <Button
                            tone="ghost"
                            className="min-h-12 self-start sm:min-h-0"
                            disabled={!currentSessionVerified || revokingSessionId !== null}
                            aria-expanded={confirmationOpen}
                            aria-controls={confirmationOpen ? `revoke-session-${session.id}` : undefined}
                            onClick={() => {
                              setSessionsError("");
                              setSessionToRevoke(session);
                            }}
                          >
                            Revoke Session
                          </Button>
                        )}
                      </div>

                      {confirmationOpen && (
                        <div
                          id={`revoke-session-${session.id}`}
                          className="flex flex-col items-start gap-3 pt-3"
                        >
                          <div className="w-full rounded-radius-lg bg-light-surface-tint p-3 ring-1 ring-border-subtle">
                            <p className="text-base font-medium sm:text-sm">Revoke This Session?</p>
                            <p className="max-w-[62ch] text-pretty text-base text-dark-text-alt sm:text-sm">
                              {session.deviceLabel} will lose access immediately. The person using it must sign in again.
                            </p>
                            <div className="flex flex-wrap gap-2 pt-3">
                              <Button
                                tone="secondary"
                                className="min-h-12 sm:min-h-0"
                                disabled={revoking}
                                onClick={() => setSessionToRevoke(null)}
                              >
                                Keep Session
                              </Button>
                              <Button
                                tone="danger"
                                className="min-h-12 min-w-32 sm:min-h-0"
                                disabled={revoking}
                                onClick={() => void revokeSession(session)}
                              >
                                {revoking ? "Revoking..." : "Revoke Session"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="sign-out-heading" className="grid gap-6 border-t border-border-subtle pt-8 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-1">
          <h2 id="sign-out-heading" className="text-base font-semibold">Sign Out</h2>
          <p className="text-pretty text-base text-dark-text-alt sm:text-sm">Previously opened boards may retain local offline data on this device.</p>
        </div>
        <form action={signOutCurrentSession} className="text-base font-medium sm:text-sm">
          <button
            type="submit"
            className="inline-flex h-12 items-center justify-center rounded-radius-md bg-surface-white px-3 ring-1 ring-border-subtle outline-none hover:bg-light-surface-tint active:bg-border-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent sm:h-9"
          >
            Sign Out
          </button>
        </form>
      </section>
    </SharedWorkspaceShell>
  );
}
