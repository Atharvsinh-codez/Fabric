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
import SidebarLeftIcon from "reicon-react/icons/SidebarLeft2";
import SidebarRightIcon from "reicon-react/icons/SidebarRight2";
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
import {
  listBoards,
  type BoardSummary,
  type WorkspaceSummary,
} from "@/lib/boards/client";

const DESKTOP_SIDEBAR_STORAGE_KEY = "fabric:workspace-sidebar-collapsed:v1";

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
  collapsed = false,
  onNavigate,
  workspaceId,
}: {
  collapsed?: boolean;
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
            aria-label={collapsed ? item.label : undefined}
            data-tooltip={collapsed ? item.label : undefined}
            data-tooltip-side="right"
            className={cx(
              "relative flex h-11 items-center rounded-radius-md font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:h-9",
              collapsed
                ? "tooltip-trigger justify-center px-0"
                : "gap-2.5 px-2.5",
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
            <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function AccountLink({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const user = useCurrentUser();
  const active = pathname === APP_ROUTES.account;

  return (
    <div className="text-base sm:text-sm">
      <Link
        href={APP_ROUTES.account}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? "Open account" : undefined}
        data-tooltip={collapsed ? "Account" : undefined}
        data-tooltip-side="right"
        className={cx(
          "group flex min-w-0 items-center rounded-radius-lg bg-surface-white/72 p-2 font-medium ring-1 ring-near-black-primary-text/6 outline-none hover:bg-surface-white focus-visible:outline-2 focus-visible:outline-sky-blue-accent",
          collapsed ? "tooltip-trigger justify-center" : "gap-2.5",
          active && "bg-sky-blue-accent/8 ring-sky-blue-accent/18",
        )}
      >
        <UserAvatar user={user} size="small" />
        {!collapsed && (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{user.name || "Fabric member"}</span>
            <span className="truncate text-[0.75rem] font-normal text-muted-gray">
              {user.email || "Signed in"}
            </span>
          </span>
        )}
        {!collapsed && (
          <ChevronRightIcon
            size={16}
            color="var(--color-muted-gray)"
            className="shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
            focusable="false"
          />
        )}
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

function workspaceInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function AvailableWorkspaceLinks({
  collapsed,
  onNavigate,
  workspaces,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
  workspaces: readonly WorkspaceSummary[];
}) {
  return (
    <nav
      aria-label="Your workspaces"
      className="flex min-h-0 flex-1 flex-col gap-2 px-3 pt-6 text-base sm:text-sm"
    >
      {!collapsed && (
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="font-medium text-muted-gray">Workspaces</p>
          <p className="text-[0.75rem] text-muted-gray tabular-nums">
            {workspaces.length}
          </p>
        </div>
      )}

      {workspaces.length > 0 ? (
        <ul
          role="list"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5"
        >
          {workspaces.map((workspace) => (
            <li key={workspace.id}>
              <Link
                href={dashboardPath({ workspaceId: workspace.id })}
                onClick={onNavigate}
                aria-label={collapsed ? `Open ${workspace.name}` : undefined}
                data-tooltip={collapsed ? workspace.name : undefined}
                data-tooltip-side="right"
                className={cx(
                  "flex min-h-11 min-w-0 items-center rounded-radius-lg outline-none hover:bg-surface-white/72 focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:min-h-10",
                  collapsed
                    ? "tooltip-trigger justify-center px-0"
                    : "gap-2.5 px-2.5",
                )}
              >
                <div
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-radius-md bg-sky-blue-accent/10 text-[0.6875rem] font-semibold text-sky-blue-accent ring-1 ring-sky-blue-accent/12"
                >
                  {workspaceInitials(workspace.name) || "FW"}
                </div>
                {collapsed ? (
                  <span className="sr-only">{workspace.name}</span>
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-near-black-primary-text">
                      {workspace.name}
                    </p>
                    <p className="truncate text-[0.75rem] capitalize text-muted-gray">
                      {workspace.role}
                    </p>
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        !collapsed && (
          <p className="px-1 text-pretty text-base text-muted-gray sm:text-sm">
            Your shared workspaces will appear here.
          </p>
        )
      )}
    </nav>
  );
}

function WorkspaceSidebarContent({
  availableWorkspaces = [],
  collapsed = false,
  onNavigate,
  recentBoards,
  workspaceId,
  workspaceName,
}: {
  availableWorkspaces?: readonly WorkspaceSummary[];
  collapsed?: boolean;
  onNavigate?: () => void;
  recentBoards?: BoardSummary[];
  workspaceId?: string;
  workspaceName?: string;
}) {
  const workspaceLabel = workspaceName ?? (workspaceId ? "Workspace" : "All Workspaces");
  const initials = workspaceInitials(workspaceLabel);

  return (
    <>
      <div
        className={cx(
          "flex h-16 shrink-0 items-center",
          collapsed ? "justify-center px-3" : "px-4",
        )}
      >
        <Link
          href="/"
          aria-label="Homepage"
          onClick={onNavigate}
          data-tooltip={collapsed ? "Fabric home" : undefined}
          data-tooltip-side="right"
          className="rounded-radius-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
        >
          <FabricLogo compact={collapsed} />
        </Link>
      </div>

      <div className="px-3 text-base sm:text-sm">
        <Link
          href={APP_ROUTES.workspaces}
          onClick={onNavigate}
          aria-label={collapsed ? "All workspaces" : undefined}
          data-tooltip={collapsed ? "All workspaces" : undefined}
          data-tooltip-side="right"
          className={cx(
            "flex min-h-11 min-w-0 items-center rounded-radius-lg bg-surface-white/72 font-medium ring-1 ring-near-black-primary-text/6 outline-none hover:bg-surface-white focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:min-h-10",
            collapsed
              ? "tooltip-trigger justify-center px-0"
              : "gap-2.5 px-2.5",
          )}
        >
          <div
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-radius-md bg-sky-blue-accent text-[0.6875rem] text-surface-white shadow-sm"
          >
            {initials || "FW"}
          </div>
          <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>
            {workspaceLabel}
          </span>
        </Link>
      </div>

      {workspaceId ? (
        <>
          <div className="px-3 pt-5">
            <WorkspaceNav
              collapsed={collapsed}
              onNavigate={onNavigate}
              workspaceId={workspaceId}
            />
          </div>

          {collapsed ? (
            <div className="flex-1" />
          ) : (
            <RecentBoardLinks
              workspaceId={workspaceId}
              initialBoards={recentBoards}
              onNavigate={onNavigate}
            />
          )}
        </>
      ) : (
        <AvailableWorkspaceLinks
          collapsed={collapsed}
          onNavigate={onNavigate}
          workspaces={availableWorkspaces}
        />
      )}

      <div className="border-t border-sky-blue-accent/10 p-3">
        <AccountLink collapsed={collapsed} onNavigate={onNavigate} />
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
  availableWorkspaces,
  eyebrow,
  title,
  description,
  action,
  workspaceId,
  workspaceName,
  recentBoards,
  children,
}: {
  availableWorkspaces?: readonly WorkspaceSummary[];
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
  workspaceId?: string;
  workspaceName?: string;
  recentBoards?: BoardSummary[];
  children: ReactNode;
}) {
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [desktopSidebarPreferenceReady, setDesktopSidebarPreferenceReady] =
    useState(false);
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
    let storedCollapsed = false;
    try {
      storedCollapsed =
        window.localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY) === "true";
    } catch {
      storedCollapsed = false;
    }

    const readyFrame = window.requestAnimationFrame(() => {
      setDesktopSidebarCollapsed(storedCollapsed);
      setDesktopSidebarPreferenceReady(true);
    });
    const syncSidebarPreference = (event: StorageEvent) => {
      if (event.key !== DESKTOP_SIDEBAR_STORAGE_KEY) return;
      setDesktopSidebarCollapsed(event.newValue === "true");
    };
    window.addEventListener("storage", syncSidebarPreference);

    return () => {
      window.cancelAnimationFrame(readyFrame);
      window.removeEventListener("storage", syncSidebarPreference);
    };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeMobileNavigation = () => {
      if (desktopQuery.matches) setMobileNav(false);
    };
    closeMobileNavigation();
    desktopQuery.addEventListener("change", closeMobileNavigation);
    return () => desktopQuery.removeEventListener("change", closeMobileNavigation);
  }, []);

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

  const toggleDesktopSidebar = () => {
    const nextCollapsed = !desktopSidebarCollapsed;
    setDesktopSidebarCollapsed(nextCollapsed);
    try {
      window.localStorage.setItem(
        DESKTOP_SIDEBAR_STORAGE_KEY,
        nextCollapsed ? "true" : "false",
      );
    } catch {
      // The preference is optional when browser storage is unavailable.
    }
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
      <div
        data-state={desktopSidebarCollapsed ? "collapsed" : "expanded"}
        className={cx(
          "relative hidden h-full shrink-0 lg:block",
          desktopSidebarPreferenceReady &&
            "motion-safe:transition-[width] motion-safe:duration-(--motion-panel) motion-safe:ease-(--ease-out-quart) motion-reduce:transition-none",
          desktopSidebarCollapsed ? "w-18" : "w-64",
        )}
      >
        <aside
          id="workspace-desktop-sidebar"
          aria-label="Workspace navigation"
          className="flex h-full w-full flex-col overflow-hidden border-r border-sky-blue-accent/10 bg-linear-to-b from-[#edf8ff] via-[#f7fbfe] to-[#f3f8fb]"
        >
          <WorkspaceSidebarContent
            availableWorkspaces={availableWorkspaces}
            collapsed={desktopSidebarCollapsed}
            workspaceId={activeWorkspaceId}
            workspaceName={workspaceName}
            recentBoards={recentBoards}
          />
        </aside>
        <div className="absolute top-4 -right-4 z-20">
          <IconButton
            label={
              desktopSidebarCollapsed
                ? "Expand workspace sidebar"
                : "Collapse workspace sidebar"
            }
            aria-controls="workspace-desktop-sidebar"
            aria-expanded={!desktopSidebarCollapsed}
            tooltipSide="right"
            className="bg-surface-white shadow-[0_6px_18px_rgb(37_43_49/0.12)] ring-1 ring-near-black-primary-text/8"
            onClick={toggleDesktopSidebar}
          >
            {desktopSidebarCollapsed ? (
              <SidebarRightIcon
                size={16}
                className="shrink-0"
                aria-hidden="true"
                focusable="false"
              />
            ) : (
              <SidebarLeftIcon
                size={16}
                className="shrink-0"
                aria-hidden="true"
                focusable="false"
              />
            )}
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-white/94 px-4 backdrop-blur-sm sm:px-6">
          <div className="lg:hidden">
            <IconButton
              label="Open workspace navigation"
              aria-haspopup="dialog"
              aria-expanded={mobileNav}
              aria-controls="workspace-mobile-sidebar"
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

      <div
        data-open={mobileNav ? "" : undefined}
        data-state={mobileNav ? "open" : "closed"}
        aria-hidden={!mobileNav}
        inert={!mobileNav}
        className="pointer-events-none invisible fixed inset-0 z-100 delay-(--motion-panel) transition-[visibility] duration-0 data-open:visible data-open:pointer-events-auto data-open:delay-0 motion-reduce:delay-0 lg:hidden"
      >
          <button
            type="button"
            tabIndex={mobileNav ? 0 : -1}
            className="modal-backdrop absolute inset-0 opacity-0 motion-safe:transition-opacity motion-safe:duration-200 data-open:opacity-100 motion-reduce:transition-none"
            data-open={mobileNav ? "" : undefined}
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          />
          <aside
            id="workspace-mobile-sidebar"
            ref={mobileNavRef}
            role="dialog"
            aria-modal="true"
            aria-label="Workspace navigation"
            data-open={mobileNav ? "" : undefined}
            className="floating-shadow absolute inset-y-0 left-0 flex w-[min(86vw,320px)] -translate-x-full flex-col bg-linear-to-b from-[#edf8ff] via-[#f7fbfe] to-[#f3f8fb] motion-safe:transition-transform motion-safe:duration-(--motion-panel) motion-safe:ease-(--ease-out-quart) data-open:translate-x-0 motion-reduce:transition-none"
          >
            <div className="absolute top-3 right-3 z-10">
              <IconButton label="Close navigation" onClick={() => setMobileNav(false)}>
                <CloseIcon size={16} className="shrink-0" aria-hidden="true" focusable="false" />
              </IconButton>
            </div>
            <WorkspaceSidebarContent
              availableWorkspaces={availableWorkspaces}
              onNavigate={() => setMobileNav(false)}
              workspaceId={activeWorkspaceId}
              workspaceName={workspaceName}
              recentBoards={recentBoards}
            />
          </aside>
      </div>

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
