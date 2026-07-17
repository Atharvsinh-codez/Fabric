"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { IconComponent } from "reicon-react/createIcon";
import ActivityIcon from "reicon-react/icons/Activity2";
import BoardsIcon from "reicon-react/icons/Layers";
import ChevronRightIcon from "reicon-react/icons/ChevronRight";
import MenuIcon from "reicon-react/icons/Menu";
import MembersIcon from "reicon-react/icons/People2";
import QuickNavIcon from "reicon-react/icons/Command3";
import SearchIcon from "reicon-react/icons/Magnifier";
import SettingsIcon from "reicon-react/icons/Settings";
import UserIcon from "reicon-react/icons/User";
import CloseIcon from "reicon-react/icons/X";

import { useCurrentUser } from "@/components/current-user-provider";
import { FabricLogo, IconButton, UserAvatar, cx } from "@/components/ui";
import {
  APP_ROUTES,
  boardPath,
  dashboardPath,
  workspaceRoutePath,
  type WorkspaceAppRoute,
} from "@/lib/app-routes";
import { listBoards, type BoardSummary } from "@/lib/boards/client";

const workspaceNavigation: Array<{
  label: string;
  href: WorkspaceAppRoute;
  icon: IconComponent;
}> = [
  { label: "Boards", href: APP_ROUTES.dashboard, icon: BoardsIcon },
  { label: "Members", href: APP_ROUTES.members, icon: MembersIcon },
  { label: "Activity", href: APP_ROUTES.activity, icon: ActivityIcon },
  { label: "Settings", href: APP_ROUTES.settings, icon: SettingsIcon },
];

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
              "relative flex h-11 items-center gap-2.5 rounded-radius-md px-2.5 font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9",
              active
                ? "bg-sky-blue-accent/8 text-near-black-primary-text ring-1 ring-sky-blue-accent/10"
                : "text-dark-text-alt hover:bg-surface-white/70 hover:text-near-black-primary-text",
            )}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute inset-y-2 left-0 w-0.5 rounded-radius-pill bg-sky-blue-accent"
              />
            )}
            <Icon
              size={16}
              weight={active ? "Filled" : "Outline"}
              color={
                active ? "var(--color-sky-blue-accent)" : "var(--color-muted-gray)"
              }
              className="shrink-0"
              aria-hidden="true"
              focusable="false"
            />
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
  const active = pathname === APP_ROUTES.account;

  return (
    <div className="text-base sm:text-sm">
      <Link
        href={APP_ROUTES.account}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cx(
          "group flex min-w-0 items-center gap-2.5 rounded-radius-lg bg-surface-white/72 p-2 font-medium ring-1 ring-near-black-primary-text/6 outline-none motion-safe:transition-transform motion-safe:duration-200 hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-sky-blue-accent",
          active && "bg-sky-blue-accent/8 ring-sky-blue-accent/18",
        )}
      >
        <UserAvatar user={user} size="small" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{user.name || "Fabric member"}</span>
          <span className="truncate text-[0.75rem] font-normal text-muted-gray">
            {user.email || "Signed in"}
          </span>
        </span>
        <ChevronRightIcon
          size={16}
          color="var(--color-muted-gray)"
          className="shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-0.5"
          aria-hidden="true"
          focusable="false"
        />
      </Link>
    </div>
  );
}

function RecentBoardLinks({
  workspaceId,
  initialBoards,
  onNavigate,
}: {
  workspaceId?: string;
  initialBoards?: BoardSummary[];
  onNavigate?: () => void;
}) {
  const [fetchedBoards, setFetchedBoards] = useState<BoardSummary[]>([]);
  const [responseWorkspaceId, setResponseWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (initialBoards !== undefined || !workspaceId) return;

    let active = true;
    void listBoards({ workspaceId, view: "recent" })
      .then((result) => {
        if (active) {
          setFetchedBoards(result);
          setResponseWorkspaceId(workspaceId);
        }
      })
      .catch(() => {
        if (active) {
          setFetchedBoards([]);
          setResponseWorkspaceId(workspaceId);
        }
      });

    return () => {
      active = false;
    };
  }, [initialBoards, workspaceId]);

  const sourceBoards =
    initialBoards ?? (responseWorkspaceId === workspaceId ? fetchedBoards : []);
  const loadingFallback =
    initialBoards === undefined && Boolean(workspaceId) && responseWorkspaceId !== workspaceId;
  const visibleBoards = sourceBoards
    .filter((board) => board.workspaceId === workspaceId && !board.archivedAt)
    .slice(0, 3);

  return (
    <div className="flex flex-1 flex-col gap-2 px-4 pt-8 text-base sm:text-sm">
      <p className="px-1 text-[0.75rem] font-medium text-muted-gray">Recent boards</p>
      {loadingFallback ? (
        <div className="grid gap-2" aria-hidden="true">
          <span className="h-4 w-4/5 animate-pulse rounded-radius-sm bg-light-surface-tint motion-reduce:animate-none" />
          <span className="h-4 w-3/5 animate-pulse rounded-radius-sm bg-light-surface-tint motion-reduce:animate-none" />
        </div>
      ) : visibleBoards.map((board) => (
        <Link
          key={board.id}
          href={boardPath(board.id)}
          onClick={onNavigate}
          className="group flex min-w-0 items-center gap-2 rounded-radius-md px-1 py-1.5 text-dark-text-alt outline-none hover:bg-surface-white/65 hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          <span className="size-1.5 shrink-0 rounded-radius-pill bg-sky-blue-accent/45 group-hover:bg-sky-blue-accent" aria-hidden="true" />
          <span className="truncate">{board.title}</span>
        </Link>
      ))}
      {!loadingFallback && visibleBoards.length === 0 && (
        <Link
          href={
            dashboardPath({ workspaceId })
          }
          onClick={onNavigate}
          className="rounded-radius-md px-1 py-1.5 text-dark-text-alt outline-none hover:bg-surface-white/65 hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          Browse all boards
        </Link>
      )}
    </div>
  );
}

function WorkspaceSidebarContent({
  onNavigate,
  recentBoards,
  workspaceId,
  workspaceName,
}: {
  onNavigate?: () => void;
  recentBoards?: BoardSummary[];
  workspaceId?: string;
  workspaceName?: string;
}) {
  const workspaceLabel = workspaceName ?? (workspaceId ? "Workspace" : "All Workspaces");
  const workspaceInitials = workspaceLabel
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <>
      <div className="flex h-16 shrink-0 items-center px-4">
        <Link
          href="/"
          aria-label="Homepage"
          onClick={onNavigate}
          className="rounded-radius-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          <FabricLogo />
        </Link>
      </div>

      <div className="px-3 text-base sm:text-sm">
        <Link
          href={APP_ROUTES.workspaces}
          onClick={onNavigate}
          className="flex min-h-11 min-w-0 items-center gap-2.5 rounded-radius-lg bg-surface-white/72 px-2.5 font-medium ring-1 ring-near-black-primary-text/6 outline-none hover:bg-surface-white focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:min-h-10"
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-radius-md bg-sky-blue-accent text-[0.6875rem] text-surface-white shadow-sm"
          >
            {workspaceInitials || "FW"}
          </span>
          <span className="min-w-0 flex-1 truncate">{workspaceLabel}</span>
        </Link>
      </div>

      {workspaceId ? (
        <>
          <div className="px-3 pt-5">
            <WorkspaceNav onNavigate={onNavigate} workspaceId={workspaceId} />
          </div>

          <RecentBoardLinks
            workspaceId={workspaceId}
            initialBoards={recentBoards}
            onNavigate={onNavigate}
          />
        </>
      ) : (
        <div className="flex-1 px-4 pt-8">
          <p className="text-pretty text-base text-muted-gray sm:text-sm">
            Choose a workspace to open its boards, members, activity, and settings.
          </p>
        </div>
      )}

      <div className="border-t border-sky-blue-accent/10 p-3">
        <AccountLink onNavigate={onNavigate} />
      </div>
    </>
  );
}

function useModalFocus(
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

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusPanel = window.requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
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
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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

export function WorkspaceShell({
  eyebrow,
  title,
  description,
  action,
  workspaceId,
  workspaceName,
  recentBoards,
  children,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  workspaceId?: string;
  workspaceName?: string;
  recentBoards?: BoardSummary[];
  children: ReactNode;
}) {
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const mobileSearchTriggerRef = useRef<HTMLButtonElement>(null);
  const commandRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const user = useCurrentUser();
  const activeWorkspaceId = workspaceId ?? searchParams.get("workspaceId") ?? undefined;
  const canSearchBoards = pathname === APP_ROUTES.dashboard;

  useModalFocus(mobileNav, mobileNavRef, () => setMobileNav(false));
  useModalFocus(commandOpen, commandRef, () => setCommandOpen(false));

  useEffect(() => {
    const openQuickNavigation = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setMobileNav(false);
        setMobileSearch(false);
        setCommandOpen(true);
      }
    };
    window.addEventListener("keydown", openQuickNavigation);
    return () => window.removeEventListener("keydown", openQuickNavigation);
  }, []);

  const searchWorkspace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("workspace-search") ?? "").trim();
    setMobileSearch(false);
    router.push(dashboardPath({ workspaceId: activeWorkspaceId, q: query }));
    window.requestAnimationFrame(() => mobileSearchTriggerRef.current?.focus());
  };

  const toggleMobileSearch = () => {
    if (mobileSearch) {
      setMobileSearch(false);
      window.requestAnimationFrame(() => mobileSearchTriggerRef.current?.focus());
      return;
    }
    setMobileSearch(true);
  };

  const searchForm = (mobile = false) => (
    <form className="relative block w-full max-w-sm" role="search" onSubmit={searchWorkspace}>
      <label htmlFor={mobile ? "workspace-search-mobile" : "workspace-search"} className="sr-only">
        Search boards
      </label>
      <SearchIcon
        size={16}
        color="var(--color-muted-gray)"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        aria-hidden="true"
        focusable="false"
      />
      <input
        key={searchParams.get("q") ?? ""}
        id={mobile ? "workspace-search-mobile" : "workspace-search"}
        name="workspace-search"
        type="search"
        autoFocus={mobile}
        placeholder="Search boards"
        defaultValue={searchParams.get("q") ?? ""}
        className="h-9 w-full rounded-radius-md bg-light-surface-tint pr-3 pl-8 text-base text-near-black-primary-text outline-none ring-1 ring-transparent placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm"
      />
    </form>
  );

  return (
    <main className="isolate flex h-dvh overflow-hidden bg-[#f7fafc] font-sans text-near-black-primary-text">
      <aside className="hidden w-64 shrink-0 border-r border-sky-blue-accent/10 bg-linear-to-b from-[#edf8ff] via-[#f7fbfe] to-[#f3f8fb] lg:flex lg:flex-col">
        <WorkspaceSidebarContent
          workspaceId={activeWorkspaceId}
          workspaceName={workspaceName}
          recentBoards={recentBoards}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-white/94 px-4 backdrop-blur-sm sm:px-6">
          <div className="lg:hidden">
            <IconButton
              label="Open workspace navigation"
              aria-haspopup="dialog"
              aria-expanded={mobileNav}
              onClick={() => {
                setCommandOpen(false);
                setMobileSearch(false);
                setMobileNav(true);
              }}
            >
              <MenuIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
            </IconButton>
          </div>
          <div className="min-w-0 flex-1 lg:hidden">
            <Link
              href="/"
              aria-label="Homepage"
              className="inline-flex rounded-radius-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
            >
              <FabricLogo />
            </Link>
          </div>
          <div className="hidden min-w-0 flex-1 lg:block">
            {canSearchBoards ? searchForm() : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canSearchBoards && <div className="lg:hidden">
              <IconButton
                ref={mobileSearchTriggerRef}
                label={mobileSearch ? "Close board search" : "Search boards"}
                active={mobileSearch}
                aria-expanded={mobileSearch}
                aria-controls="workspace-mobile-search"
                onClick={toggleMobileSearch}
              >
                {mobileSearch ? (
                  <CloseIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
                ) : (
                  <SearchIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
                )}
              </IconButton>
            </div>}
            <IconButton
              label="Open quick navigation"
              aria-haspopup="dialog"
              aria-expanded={commandOpen}
              aria-keyshortcuts="Meta+K Control+K"
              onClick={() => {
                setMobileNav(false);
                setMobileSearch(false);
                setCommandOpen(true);
              }}
            >
              <QuickNavIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
            </IconButton>
            <div className="text-base lg:hidden">
              <Link
                href={APP_ROUTES.account}
                aria-label="Open account"
                className="grid size-9 place-items-center rounded-radius-pill outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
              >
                <UserAvatar user={user} size="medium" />
              </Link>
            </div>
          </div>
        </header>

        {mobileSearch && (
          <div id="workspace-mobile-search" className="border-b border-border-subtle bg-surface-white px-4 py-3 lg:hidden">
            {searchForm(true)}
          </div>
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="app-page-enter mx-auto w-full min-w-0 max-w-7xl px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
            <div className="flex flex-col gap-4 border-b border-border-subtle pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1.5">
                <p className="text-label-small font-medium text-muted-gray">
                  {eyebrow ?? workspaceName ?? "Fabric"}
                </p>
                <h1 className="text-balance text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="max-w-[68ch] text-pretty text-base text-[var(--text-2)] sm:text-sm">
                  {description}
                </p>
              </div>
              {action && <div className="shrink-0">{action}</div>}
            </div>
            <div className="flex flex-col gap-8 pt-7">{children}</div>
          </div>
        </div>
      </div>

      {mobileNav && (
        <div className="fixed inset-0 z-100 lg:hidden">
          <button
            type="button"
            className="modal-backdrop absolute inset-0"
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
          <aside
            ref={mobileNavRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            className="floating-shadow drawer-enter absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-linear-to-b from-[#edf8ff] via-[#f7fbfe] to-[#f3f8fb]"
          >
            <div className="absolute top-3 right-3 z-10">
              <IconButton label="Close navigation" onClick={() => setMobileNav(false)}>
                <CloseIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
              </IconButton>
            </div>
            <WorkspaceSidebarContent
              onNavigate={() => setMobileNav(false)}
              workspaceId={activeWorkspaceId}
              workspaceName={workspaceName}
              recentBoards={recentBoards}
            />
          </aside>
        </div>
      )}

      {commandOpen && (
        <div className="fixed inset-0 z-110 grid place-items-start px-4 pt-[12vh]">
          <button
            type="button"
            className="modal-backdrop absolute inset-0"
            aria-label="Close quick navigation"
            onClick={() => setCommandOpen(false)}
          />
          <section
            ref={commandRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="workspace-quick-navigation-title"
            className="floating-shadow dialog-enter relative mx-auto flex w-full max-w-md flex-col overflow-hidden rounded-radius-2xl bg-surface-white ring-1 ring-near-black-primary-text/10"
          >
            <div className="flex items-center justify-between gap-4 border-b border-border-subtle px-4 py-3">
              <div>
                <p className="text-label-small font-medium text-muted-gray">Workspace</p>
                <h2 id="workspace-quick-navigation-title" className="text-base font-semibold">
                  Quick navigation
                </h2>
              </div>
              <IconButton label="Close quick navigation" onClick={() => setCommandOpen(false)}>
                <CloseIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
              </IconButton>
            </div>
            <nav aria-label="Quick navigation" className="grid gap-1 p-2">
              {[
                ...(activeWorkspaceId
                  ? workspaceNavigation.map((item) => ({
                      ...item,
                      href: workspaceRoutePath(item.href, activeWorkspaceId),
                    }))
                  : [
                      {
                        label: "All Workspaces",
                        href: APP_ROUTES.workspaces,
                        icon: BoardsIcon,
                      },
                    ]),
                { label: "Account", href: APP_ROUTES.account, icon: UserIcon },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setCommandOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-radius-lg px-3 text-base font-medium outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:text-sm"
                  >
                    <Icon
                      size={16}
                      color="var(--color-sky-blue-accent)"
                      className="shrink-0"
                      aria-hidden="true"
                      focusable="false"
                    />
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
