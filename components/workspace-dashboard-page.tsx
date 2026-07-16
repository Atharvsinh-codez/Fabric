"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import AddIcon from "reicon-react/icons/Add2";
import ArrowRightIcon from "reicon-react/icons/ArrowRight";
import RefreshIcon from "reicon-react/icons/Refresh";

import { WorkspaceShell } from "@/components/workspace-shell";
import { Button } from "@/components/ui";
import { BoardCoverPicker } from "@/components/board-cover-picker";
import {
  archiveBoard,
  createBoard as createBoardRequest,
  createProject,
  listBoardsPage,
  listProjects,
  listWorkspaces,
  restoreBoard,
  updateBoardMetadata,
  updateBoardPreference,
  updateProjectPreference,
  type BoardSummary,
  type ProjectSummary,
  type WorkspaceSummary,
} from "@/lib/boards/client";

const BOARD_VIEWS = [
  "recent",
  "favorite",
  "pinned",
  "shared",
  "archived",
  "all",
] as const;
type BoardView = (typeof BOARD_VIEWS)[number];
const BOARD_STATUSES = ["draft", "active", "review", "approved"] as const;

const dashboardDateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

function formatDashboardDate(value: string) {
  return dashboardDateFormatter.format(new Date(value));
}

function canEditBoard(role: BoardSummary["role"]): boolean {
  return role === "owner" || role === "editor";
}

function BoardPreview({ board }: { board: BoardSummary }) {
  if (board.cover?.kind === "asset") {
    return (
      <div
        className="relative aspect-[16/10] overflow-hidden rounded-t-radius-xl bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `url(/api/boards/${encodeURIComponent(board.id)}/assets/${encodeURIComponent(board.cover.assetId)})`,
        }}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-linear-to-t from-black/55 via-black/5 to-transparent" />
        <p className="absolute right-3 bottom-3 rounded-radius-pill bg-black/55 px-2 py-1 text-[0.6875rem] font-medium text-white backdrop-blur-sm">
          Revision {board.revision}
        </p>
      </div>
    );
  }
  const variant =
    [...board.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) %
    3;
  const layouts = [
    {
      note: "top-[13%] left-[8%] w-[38%] -rotate-2 bg-[#fff1a8] text-[#644c00]",
      cluster:
        "top-[15%] right-[8%] w-[34%] rotate-1 bg-[#dff3ff] text-[#075b86]",
      frame: "bottom-[12%] left-[26%] w-[48%] bg-surface-white",
      connector: "top-[47%] left-[38%] w-[24%] rotate-[19deg]",
    },
    {
      note: "top-[16%] right-[9%] w-[36%] rotate-2 bg-[#eee8ff] text-[#5d459f]",
      cluster:
        "top-[12%] left-[8%] w-[35%] -rotate-1 bg-[#e4f5e8] text-[#26734d]",
      frame: "bottom-[11%] left-[12%] w-[54%] bg-surface-white",
      connector: "top-[48%] left-[28%] w-[32%] -rotate-[16deg]",
    },
    {
      note: "top-[12%] left-[11%] w-[35%] rotate-1 bg-[#ffe7dc] text-[#8a3e24]",
      cluster:
        "top-[21%] right-[9%] w-[37%] -rotate-2 bg-[#dff3ff] text-[#075b86]",
      frame: "bottom-[10%] right-[19%] w-[52%] bg-surface-white",
      connector: "top-[45%] left-[41%] w-[24%] rotate-[29deg]",
    },
  ] as const;
  const layout = layouts[variant] ?? layouts[0];
  const presetTone =
    board.cover?.kind === "preset"
      ? {
          sky: "bg-[#eef8ff]",
          mint: "bg-[#edf9f0]",
          violet: "bg-[#f3efff]",
          sunset: "bg-[#fff1ea]",
          sand: "bg-[#faf3e5]",
          slate: "bg-[#eef1f4]",
        }[board.cover.value]
      : "bg-[var(--canvas)]";

  return (
    <div
      className={`relative aspect-[16/10] overflow-hidden rounded-t-radius-xl ${presetTone} [background-image:linear-gradient(rgb(18_18_18/4%)_1px,transparent_1px),linear-gradient(90deg,rgb(18_18_18/4%)_1px,transparent_1px)] [background-size:22px_22px]`}
      aria-hidden="true"
    >
      <div className="absolute inset-x-0 top-0 h-20 bg-linear-to-b from-sky-blue-accent/7 to-transparent" />

      <div
        className={`absolute rounded-radius-md p-2.5 shadow-sm ring-1 ring-black/5 motion-safe:transition-transform motion-safe:duration-300 group-hover:-translate-y-1 ${layout.note}`}
      >
        <p className="line-clamp-2 text-[0.6875rem] font-medium">
          {board.title}
        </p>
        <div className="flex flex-col gap-1 pt-2">
          <span className="h-1 w-full rounded-radius-pill bg-current opacity-15" />
          <span className="h-1 w-3/4 rounded-radius-pill bg-current opacity-10" />
        </div>
      </div>

      <div
        className={`absolute rounded-radius-md p-2.5 shadow-sm ring-1 ring-black/5 motion-safe:transition-transform motion-safe:duration-300 group-hover:translate-x-1 ${layout.cluster}`}
      >
        <p className="text-[0.625rem] font-medium">Evidence cluster</p>
        <div className="grid grid-cols-3 gap-1 pt-2">
          <span className="h-7 rounded-radius-sm bg-white/72" />
          <span className="h-7 rounded-radius-sm bg-white/72" />
          <span className="h-7 rounded-radius-sm bg-white/72" />
        </div>
      </div>

      <div
        className={`absolute rounded-radius-lg p-2.5 shadow-sm ring-1 ring-black/6 motion-safe:transition-transform motion-safe:duration-300 group-hover:translate-y-0.5 ${layout.frame}`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[0.625rem] font-medium">Decision frame</p>
          <span className="size-1.5 rounded-radius-pill bg-sky-blue-accent" />
        </div>
        <div className="grid grid-cols-3 gap-1 pt-2">
          <span className="h-5 rounded-radius-sm bg-[#e8f5ff]" />
          <span className="h-5 rounded-radius-sm bg-[#f0ebff]" />
          <span className="h-5 rounded-radius-sm bg-[#e4f6e9]" />
        </div>
      </div>

      <span
        className={`absolute h-px origin-left bg-sky-blue-accent/48 ${layout.connector}`}
      />

      <p className="absolute right-3 bottom-3 rounded-radius-pill bg-surface-white/88 px-2 py-1 text-[0.6875rem] font-medium text-muted-gray shadow-sm ring-1 ring-black/5 backdrop-blur-sm">
        Revision {board.revision}
      </p>
    </div>
  );
}

function DashboardToast({ message }: { message: string | null }) {
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

function DashboardSkeleton() {
  return (
    <div
      className="grid gap-4 @container @[42rem]:grid-cols-2"
      aria-label="Loading boards"
    >
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="overflow-hidden rounded-radius-lg bg-surface-white ring-1 ring-border-subtle"
        >
          <div className="aspect-[16/10] animate-pulse bg-light-surface-tint motion-reduce:animate-none" />
          <div className="h-[4.0625rem] animate-pulse border-t border-border-subtle bg-surface-white motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

export function WorkspaceDashboardPage({
  workspaceId,
  query = "",
  view,
  projectId,
  status,
  initialBoards,
  organizationEnabled,
  initialProjects,
  initialWorkspaces,
  initialLoadError = false,
}: {
  workspaceId?: string;
  query?: string;
  view?: string;
  projectId?: string;
  status?: string;
  initialBoards: BoardSummary[];
  organizationEnabled: boolean;
  initialProjects: ProjectSummary[];
  initialWorkspaces: WorkspaceSummary[];
  initialLoadError?: boolean;
}) {
  const router = useRouter();
  const [boards, setBoards] = useState(initialBoards);
  const [projects, setProjects] = useState(initialProjects);
  const [workspaces, setWorkspaces] = useState(initialWorkspaces);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    initialLoadError ? "error" : "ready",
  );
  const [creating, setCreating] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [mutatingBoardId, setMutatingBoardId] = useState<string | null>(null);
  const [boardPagination, setBoardPagination] = useState<{
    queryKey: string;
    nextCursor: string | null;
  }>({ queryKey: "", nextCursor: null });
  const [loadingMoreQueryKey, setLoadingMoreQueryKey] = useState<string | null>(
    null,
  );
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const boardRequestVersion = useRef(0);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = (message: string) => {
    setToastMessage(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2400);
  };

  const activeWorkspace =
    workspaces.find((candidate) => candidate.id === workspaceId) ??
    workspaces[0] ??
    null;
  const activeWorkspaceId = activeWorkspace?.id;
  const activeView: BoardView = organizationEnabled && BOARD_VIEWS.includes(view as BoardView)
    ? (view as BoardView)
    : "recent";
  const activeStatus = organizationEnabled && BOARD_STATUSES.includes(
    status as (typeof BOARD_STATUSES)[number],
  )
    ? (status as (typeof BOARD_STATUSES)[number])
    : undefined;
  const activeProjectId = organizationEnabled && projects.some((project) => project.id === projectId)
    ? projectId
    : undefined;
  const normalizedQuery = organizationEnabled ? query.trim() : "";
  const boardQueryKey = JSON.stringify([
    activeWorkspaceId ?? null,
    activeView,
    normalizedQuery,
    activeProjectId ?? null,
    activeStatus ?? null,
  ]);
  const nextBoardCursor =
    boardPagination.queryKey === boardQueryKey
      ? boardPagination.nextCursor
      : null;
  const loadingMoreBoards = loadingMoreQueryKey === boardQueryKey;
  const activeBoards = useMemo(
    () => boards.filter((board) => board.workspaceId === activeWorkspace?.id),
    [activeWorkspace?.id, boards],
  );
  const visibleBoards = activeBoards;

  useEffect(() => {
    if (!activeWorkspaceId) return;
    const requestVersion = ++boardRequestVersion.current;
    let active = true;
    void Promise.all([
      listBoardsPage({
        workspaceId: activeWorkspaceId,
        view: activeView,
        q: organizationEnabled ? query || undefined : undefined,
        projectId: activeProjectId,
        status: activeStatus,
      }),
      organizationEnabled
        ? listProjects(activeWorkspaceId)
        : Promise.resolve([]),
    ])
      .then(([boardPage, nextProjects]) => {
        if (!active || boardRequestVersion.current !== requestVersion) return;
        setBoards(boardPage.boards);
        setBoardPagination({
          queryKey: boardQueryKey,
          nextCursor: boardPage.nextCursor,
        });
        setProjects(nextProjects);
        setLoadState("ready");
      })
      .catch(() => {
        if (active && boardRequestVersion.current === requestVersion) {
          setBoardPagination({ queryKey: boardQueryKey, nextCursor: null });
          setLoadState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [
    activeProjectId,
    activeStatus,
    activeView,
    activeWorkspaceId,
    boardQueryKey,
    organizationEnabled,
    query,
  ]);

  const retryLoad = async () => {
    const requestVersion = ++boardRequestVersion.current;
    setLoadState("loading");
    setBoardPagination({ queryKey: boardQueryKey, nextCursor: null });
    setLoadingMoreQueryKey(null);
    try {
      const nextWorkspaces = await listWorkspaces();
      const nextWorkspace =
        nextWorkspaces.find(
          (workspace) => workspace.id === activeWorkspace?.id,
        ) ??
        nextWorkspaces[0] ??
        null;
      const [boardPage, nextProjects] = nextWorkspace
        ? await Promise.all([
            listBoardsPage({
              workspaceId: nextWorkspace.id,
              view: activeView,
              q: organizationEnabled ? query || undefined : undefined,
              projectId: activeProjectId,
              status: activeStatus,
            }),
            organizationEnabled
              ? listProjects(nextWorkspace.id)
              : Promise.resolve([]),
          ])
        : [{ boards: [], nextCursor: null }, []];
      if (boardRequestVersion.current !== requestVersion) return;
      setBoards(boardPage.boards);
      setBoardPagination({
        queryKey: boardQueryKey,
        nextCursor: boardPage.nextCursor,
      });
      setProjects(nextProjects);
      setWorkspaces(nextWorkspaces);
      setLoadState("ready");
    } catch {
      if (boardRequestVersion.current === requestVersion) {
        setLoadState("error");
      }
    }
  };

  const loadMoreBoards = async () => {
    if (
      !activeWorkspaceId ||
      !nextBoardCursor ||
      loadingMoreBoards ||
      loadState !== "ready"
    ) {
      return;
    }
    const requestVersion = boardRequestVersion.current;
    const requestQueryKey = boardQueryKey;
    const cursor = nextBoardCursor;
    setLoadingMoreQueryKey(requestQueryKey);
    try {
      const boardPage = await listBoardsPage({
        workspaceId: activeWorkspaceId,
        view: activeView,
        q: organizationEnabled ? query || undefined : undefined,
        projectId: activeProjectId,
        status: activeStatus,
        cursor,
      });
      if (boardRequestVersion.current !== requestVersion) return;
      setBoards((current) => {
        const knownIds = new Set(current.map((board) => board.id));
        return [
          ...current,
          ...boardPage.boards.filter((board) => !knownIds.has(board.id)),
        ];
      });
      setBoardPagination({
        queryKey: requestQueryKey,
        nextCursor: boardPage.nextCursor,
      });
    } catch (error) {
      if (boardRequestVersion.current === requestVersion) {
        showToast(
          error instanceof Error
            ? error.message
            : "More boards could not be loaded.",
        );
      }
    } finally {
      setLoadingMoreQueryKey((current) =>
        current === requestQueryKey ? null : current,
      );
    }
  };

  const handleCreateBoard = async () => {
    if (loadState !== "ready") return;

    if (!activeWorkspace) {
      router.push("/app/onboarding");
      return;
    }

    setCreating(true);
    try {
      const board = await createBoardRequest({
        workspaceId: activeWorkspace.id,
        projectId: organizationEnabled ? activeProjectId : undefined,
        title: "Untitled board",
        document: { version: 1, nodes: [], edges: [] },
      });
      setBoards((current) => [board, ...current]);
      router.push(`/app/product-studio/boards/${board.id}`);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The board could not be created.",
      );
      setCreating(false);
    }
  };

  const updateFilters = (updates: Record<string, string | undefined>) => {
    if (!activeWorkspace) return;
    const params = new URLSearchParams();
    params.set("workspaceId", activeWorkspace.id);
    if (organizationEnabled && query) params.set("q", query);
    if (organizationEnabled && activeView !== "recent") params.set("view", activeView);
    if (organizationEnabled && activeProjectId) params.set("projectId", activeProjectId);
    if (organizationEnabled && activeStatus) params.set("status", activeStatus);
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/app/product-studio?${params.toString()}`);
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeWorkspace) return;
    const name = String(
      new FormData(event.currentTarget).get("project-name") ?? "",
    ).trim();
    if (!name) return;
    setCreatingProject(true);
    try {
      const project = await createProject({
        workspaceId: activeWorkspace.id,
        name,
      });
      setProjects((current) => [...current, project]);
      event.currentTarget.reset();
      showToast(`${project.name} Project Created`);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The project could not be created.",
      );
    } finally {
      setCreatingProject(false);
    }
  };

  const mutateBoard = async (
    boardId: string,
    operation: () => Promise<BoardSummary>,
  ) => {
    setMutatingBoardId(boardId);
    try {
      const updated = await operation();
      setBoards((current) => {
        if (activeView === "archived" && !updated.archivedAt) {
          return current.filter((board) => board.id !== boardId);
        }
        if (activeView !== "archived" && updated.archivedAt) {
          return current.filter((board) => board.id !== boardId);
        }
        return current.map((board) =>
          board.id === boardId ? { ...board, ...updated } : board,
        );
      });
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The board could not be updated.",
      );
    } finally {
      setMutatingBoardId(null);
    }
  };

  const toggleBoardPreference = async (
    board: BoardSummary,
    preference: "favorite" | "pinned",
  ) => {
    setMutatingBoardId(board.id);
    try {
      const updated = await updateBoardPreference({
        boardId: board.id,
        [preference]: !board[preference],
      });
      setBoards((current) =>
        current
          .map((candidate) =>
            candidate.id === board.id
              ? { ...candidate, ...updated }
              : candidate,
          )
          .filter(
            (candidate) => activeView !== "favorite" || candidate.favorite,
          ),
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The board preference could not be updated.",
      );
    } finally {
      setMutatingBoardId(null);
    }
  };

  const toggleProjectPin = async (project: ProjectSummary) => {
    if (!activeWorkspace) return;
    try {
      const preference = await updateProjectPreference({
        workspaceId: activeWorkspace.id,
        projectId: project.id,
        pinned: !project.pinned,
      });
      setProjects((current) =>
        current.map((candidate) =>
          candidate.id === project.id
            ? { ...candidate, pinned: preference.pinned }
            : candidate,
        ),
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "The project pin could not be updated.",
      );
    }
  };

  const canCreateBoards =
    activeWorkspace?.role === "owner" || activeWorkspace?.role === "editor";

  return (
    <WorkspaceShell
      title="Boards"
      workspaceId={activeWorkspace?.id}
      workspaceName={activeWorkspace?.name}
      recentBoards={boards}
      description={
        activeWorkspace
          ? `Create, organize, and open boards in ${activeWorkspace.name}.`
          : "Create, organize, and open boards with your team."
      }
      action={
        canCreateBoards ? (
          <Button
            tone="primary"
            size="default"
            className="w-full sm:w-auto"
            leading={
              <AddIcon
                size={16}
                className="shrink-0"
                aria-hidden="true"
                focusable="false"
              />
            }
            onClick={handleCreateBoard}
            disabled={creating || loadState !== "ready"}
          >
            {creating ? "Creating…" : "Create board"}
          </Button>
        ) : null
      }
    >
      <section
        aria-labelledby="workspace-overview-heading"
        className="@container"
      >
        <h2 id="workspace-overview-heading" className="sr-only">
          Workspace overview
        </h2>
        <dl className="grid divide-y divide-near-black-primary-text/8 border-y border-near-black-primary-text/8 @[34rem]:grid-cols-3 @[34rem]:divide-x @[34rem]:divide-y-0">
          {[
            [
              "Visible boards",
              loadState === "ready" ? String(activeBoards.length) : "—",
            ],
            ["Your role", activeWorkspace?.role ?? "—"],
            [
              "Latest revision",
              loadState === "ready" && activeBoards[0]
                ? `#${activeBoards[0].revision}`
                : "—",
            ],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 px-4 py-3.5 sm:px-5 sm:py-4">
              <dt className="truncate text-sm font-medium text-muted-gray">
                {label}
              </dt>
              <dd className="mt-1 truncate text-xl font-medium capitalize text-near-black-primary-text tabular-nums">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {organizationEnabled ? (
        <section
          aria-labelledby="board-view-heading"
          className="flex flex-col gap-4"
        >
        <div className="flex flex-col gap-3 border-b border-near-black-primary-text/8 pb-4 @container">
          <div className="flex flex-col gap-3 @[48rem]:flex-row @[48rem]:items-end @[48rem]:justify-between">
            <div className="min-w-0">
              <h2 id="board-view-heading" className="text-base font-semibold">
                Board Views
              </h2>
              <p className="text-pretty text-base text-muted-gray sm:text-sm">
                Filter the active workspace without crossing its membership
                boundary.
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              <div className="inline-grid min-w-44 grid-cols-[1fr_--spacing(8)]">
                <label htmlFor="project-filter" className="sr-only">
                  Project
                </label>
                <select
                  id="project-filter"
                  name="project-filter"
                  value={activeProjectId ?? ""}
                  onChange={(event) =>
                    updateFilters({
                      projectId: event.target.value || undefined,
                    })
                  }
                  className="col-span-full row-start-1 h-9 appearance-none rounded-radius-md bg-surface-white pr-8 pl-3 text-base ring-1 ring-near-black-primary-text/10 outline-none focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm"
                >
                  <option value="">All Projects</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden="true"
                  className="pointer-events-none col-start-2 row-start-1 place-self-center text-muted-gray"
                >
                  ⌄
                </span>
              </div>
              <div className="inline-grid min-w-36 grid-cols-[1fr_--spacing(8)]">
                <label htmlFor="status-filter" className="sr-only">
                  Status
                </label>
                <select
                  id="status-filter"
                  name="status-filter"
                  value={activeStatus ?? ""}
                  disabled={activeView === "archived"}
                  onChange={(event) =>
                    updateFilters({ status: event.target.value || undefined })
                  }
                  className="col-span-full row-start-1 h-9 appearance-none rounded-radius-md bg-surface-white pr-8 pl-3 text-base capitalize ring-1 ring-near-black-primary-text/10 outline-none focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent disabled:opacity-55 sm:h-8 sm:text-sm"
                >
                  <option value="">All Statuses</option>
                  {BOARD_STATUSES.map((boardStatus) => (
                    <option key={boardStatus} value={boardStatus}>
                      {boardStatus}
                    </option>
                  ))}
                </select>
                <span
                  aria-hidden="true"
                  className="pointer-events-none col-start-2 row-start-1 place-self-center text-muted-gray"
                >
                  ⌄
                </span>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div
              className="flex min-w-max gap-1"
              role="tablist"
              aria-label="Board view"
            >
              {[
                ["recent", "Recent"],
                ["favorite", "Favorites"],
                ["pinned", "Pinned"],
                ["shared", "Shared With Me"],
                ["all", "All Boards"],
                ["archived", "Archived"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={activeView === value}
                  onClick={() =>
                    updateFilters({
                      view: value === "recent" ? undefined : value,
                      status: value === "archived" ? undefined : activeStatus,
                    })
                  }
                  className={`relative min-h-11 rounded-radius-md px-3 text-base font-medium outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:min-h-8 sm:text-sm ${
                    activeView === value
                      ? "bg-sky-blue-accent/9 text-near-black-primary-text"
                      : "text-muted-gray hover:bg-light-surface-tint hover:text-near-black-primary-text"
                  }`}
                >
                  {label}
                  <span
                    className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="@container">
          <div className="grid gap-3 @[48rem]:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] @[48rem]:items-center">
            <ul role="list" className="flex min-w-0 gap-2 overflow-x-auto pb-1">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="flex shrink-0 items-center gap-1"
                >
                  <button
                    type="button"
                    aria-pressed={activeProjectId === project.id}
                    onClick={() =>
                      updateFilters({
                        projectId:
                          activeProjectId === project.id
                            ? undefined
                            : project.id,
                      })
                    }
                    className={`relative flex min-h-11 items-center gap-2 rounded-radius-md px-3 text-base font-medium ring-1 outline-none focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:min-h-8 sm:text-sm ${
                      activeProjectId === project.id
                        ? "bg-sky-blue-accent/9 ring-sky-blue-accent/20"
                        : "bg-surface-white ring-near-black-primary-text/8 hover:bg-light-surface-tint"
                    }`}
                  >
                    <span className="max-w-40 truncate">{project.name}</span>
                    <span
                      className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                      aria-hidden="true"
                    />
                  </button>
                  <button
                    type="button"
                    aria-pressed={project.pinned}
                    aria-label={
                      project.pinned
                        ? `Unpin ${project.name}`
                        : `Pin ${project.name}`
                    }
                    onClick={() => void toggleProjectPin(project)}
                    className="relative min-h-11 rounded-radius-md px-2 text-base font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent sm:min-h-8 sm:text-sm"
                  >
                    {project.pinned ? "Unpin" : "Pin"}
                    <span
                      className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
            {canCreateBoards && (
              <form
                onSubmit={handleCreateProject}
                className="flex min-w-0 gap-2"
              >
                <label htmlFor="project-name" className="sr-only">
                  Project Name
                </label>
                <input
                  id="project-name"
                  name="project-name"
                  type="text"
                  maxLength={120}
                  placeholder="New project name"
                  className="h-9 min-w-0 flex-1 rounded-radius-md bg-surface-white px-3 text-base ring-1 ring-near-black-primary-text/10 outline-none placeholder:text-muted-gray focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent sm:h-8 sm:text-sm"
                />
                <Button
                  type="submit"
                  tone="secondary"
                  size="compact"
                  disabled={creatingProject}
                >
                  {creatingProject ? "Creating..." : "Add Project"}
                </Button>
              </form>
            )}
          </div>
        </div>
        </section>
      ) : null}

      <div className="@container">
        <div className="grid items-start gap-8 @[70rem]:grid-cols-[minmax(0,1fr)_20rem]">
          <section
            aria-labelledby="recent-boards-heading"
            aria-busy={loadState === "loading"}
            className="min-w-0 @container"
          >
            <div className="flex items-end justify-between gap-4 pb-4">
              <div>
                <h2
                  id="recent-boards-heading"
                  className="text-base font-semibold"
                >
                  {
                    {
                      recent: "Recent Boards",
                      favorite: "Favorite Boards",
                      pinned: "Pinned Boards",
                      shared: "Shared With Me",
                      archived: "Archived Boards",
                      all: "All Boards",
                    }[activeView]
                  }
                </h2>
                <p className="mt-1 text-base text-muted-gray sm:text-sm">
                  {activeView === "archived"
                    ? "Restore boards without losing their links."
                    : "Sorted by latest activity."}
                </p>
              </div>
              {loadState === "ready" && (
                <p className="shrink-0 text-sm text-muted-gray tabular-nums">
                  {visibleBoards.length}{" "}
                  {nextBoardCursor
                    ? "boards loaded"
                    : visibleBoards.length === 1
                      ? "board"
                      : "boards"}
                </p>
              )}
            </div>

            {loadState === "loading" && (
              <>
                <p className="sr-only" role="status">
                  Loading boards
                </p>
                <DashboardSkeleton />
              </>
            )}

            {loadState === "error" && (
              <div
                role="alert"
                className="flex min-h-44 flex-col items-start justify-center gap-3 rounded-radius-xl bg-surface-white p-5 ring-1 ring-border-subtle"
              >
                <div>
                  <h3 className="text-base font-semibold">
                    Boards could not be loaded
                  </h3>
                  <p className="mt-1 max-w-[50ch] text-base text-[var(--text-2)] sm:text-sm">
                    Check your connection and try again. Your saved work is
                    unchanged.
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

            {loadState === "ready" && visibleBoards.length === 0 && (
              <div className="flex min-h-44 flex-col items-start justify-center gap-3 rounded-radius-xl bg-surface-white p-5 ring-1 ring-border-subtle">
                <div>
                  <h3 className="text-base font-semibold">
                    {normalizedQuery
                      ? "No boards match this search"
                      : "Start with a clean canvas"}
                  </h3>
                  <p className="mt-1 max-w-[50ch] text-base text-[var(--text-2)] sm:text-sm">
                    {normalizedQuery
                      ? `No board in this view contains “${query.trim()}” in its title.`
                      : activeView === "archived"
                        ? "Archived boards will appear here and remain available to restore."
                        : "Create the first board for this workspace, then invite collaborators when you are ready."}
                  </p>
                </div>
                {!normalizedQuery && canCreateBoards && (
                  <Button
                    tone="secondary"
                    onClick={handleCreateBoard}
                    disabled={creating}
                  >
                    Create the first board
                  </Button>
                )}
              </div>
            )}

            {loadState === "ready" && visibleBoards.length > 0 && (
              <ul role="list" className="grid gap-4 @[42rem]:grid-cols-2">
                {visibleBoards.map((board, index) => (
                  <li
                    key={board.id}
                    className="board-card-enter min-w-0"
                    style={
                      {
                        "--board-card-delay": `${Math.min(index, 5) * 55}ms`,
                      } as CSSProperties
                    }
                  >
                    <article className="soft-shadow overflow-hidden rounded-radius-xl bg-surface-white ring-1 ring-near-black-primary-text/7">
                      <Link
                        href={`/app/product-studio/boards/${board.id}`}
                        aria-label={`Open ${board.title}`}
                        className="group outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-blue-accent"
                      >
                        <BoardPreview board={board} />
                      </Link>
                      <div className="flex min-w-0 flex-col gap-3 border-t border-border-subtle p-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <Link
                              href={`/app/product-studio/boards/${board.id}`}
                              className="group flex min-w-0 items-center gap-2 rounded-radius-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                            >
                              <p className="truncate text-base font-medium text-near-black-primary-text sm:text-sm">
                                {board.title}
                              </p>
                              <ArrowRightIcon
                                size={16}
                                color="var(--color-muted-gray)"
                                className="shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-0.5"
                                aria-hidden="true"
                                focusable="false"
                              />
                            </Link>
                            <p className="truncate text-base text-muted-gray sm:text-sm">
                              {board.projectName ?? "Unfiled"} · Updated{" "}
                              {formatDashboardDate(board.updatedAt)}
                            </p>
                          </div>
                          {organizationEnabled ? (
                            <p className="shrink-0 rounded-radius-pill bg-light-surface-tint px-2 py-1 text-base font-medium capitalize text-dark-text-alt sm:text-sm">
                              {board.status}
                            </p>
                          ) : null}
                        </div>
                        {organizationEnabled ? (
                          <div className="flex flex-wrap items-center gap-2 border-t border-near-black-primary-text/6 pt-3">
                          <button
                            type="button"
                            disabled={mutatingBoardId === board.id}
                            onClick={() =>
                              void toggleBoardPreference(board, "favorite")
                            }
                            className="relative min-h-11 rounded-radius-md px-2.5 text-base font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:opacity-45 sm:min-h-8 sm:text-sm"
                          >
                            {board.favorite ? "Unfavorite" : "Favorite"}
                            <span
                              className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            disabled={mutatingBoardId === board.id}
                            onClick={() =>
                              void toggleBoardPreference(board, "pinned")
                            }
                            className="relative min-h-11 rounded-radius-md px-2.5 text-base font-medium text-muted-gray outline-none hover:bg-light-surface-tint hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:opacity-45 sm:min-h-8 sm:text-sm"
                          >
                            {board.pinned ? "Unpin" : "Pin"}
                            <span
                              className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                              aria-hidden="true"
                            />
                          </button>
                          {board.archivedAt && canEditBoard(board.role) ? (
                            <button
                              type="button"
                              disabled={mutatingBoardId === board.id}
                              onClick={() =>
                                void mutateBoard(board.id, () =>
                                  restoreBoard(board.id),
                                )
                              }
                              className="relative min-h-11 rounded-radius-md px-2.5 text-base font-medium text-dark-text-alt outline-none hover:bg-light-surface-tint focus-visible:outline-2 focus-visible:outline-sky-blue-accent disabled:opacity-45 sm:min-h-8 sm:text-sm"
                            >
                              Restore Board
                              <span
                                className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                                aria-hidden="true"
                              />
                            </button>
                          ) : !board.archivedAt && canEditBoard(board.role) ? (
                            <>
                              <BoardCoverPicker
                                board={board}
                                disabled={mutatingBoardId === board.id}
                                onUpdated={(updated) =>
                                  setBoards((current) =>
                                    current.map((candidate) =>
                                      candidate.id === board.id
                                        ? { ...candidate, ...updated }
                                        : candidate,
                                    ),
                                  )
                                }
                                onError={showToast}
                              />
                              <label
                                htmlFor={`status-${board.id}`}
                                className="sr-only"
                              >
                                Board Status
                              </label>
                              <select
                                id={`status-${board.id}`}
                                name={`status-${board.id}`}
                                value={board.status}
                                disabled={mutatingBoardId === board.id}
                                onChange={(event) =>
                                  void mutateBoard(board.id, () =>
                                    updateBoardMetadata({
                                      boardId: board.id,
                                      status: event.target
                                        .value as (typeof BOARD_STATUSES)[number],
                                    }),
                                  )
                                }
                                className="h-9 rounded-radius-md bg-surface-white px-2 text-base capitalize ring-1 ring-near-black-primary-text/10 outline-none focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-sky-blue-accent disabled:opacity-45 sm:h-8 sm:text-sm"
                              >
                                {BOARD_STATUSES.map((boardStatus) => (
                                  <option key={boardStatus} value={boardStatus}>
                                    {boardStatus}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={mutatingBoardId === board.id}
                                onClick={() =>
                                  void mutateBoard(board.id, () =>
                                    archiveBoard(board.id),
                                  )
                                }
                                className="relative min-h-11 rounded-radius-md px-2.5 text-base font-medium text-[var(--danger)] outline-none hover:bg-[var(--danger-soft)] focus-visible:outline-2 focus-visible:outline-[var(--danger)] disabled:opacity-45 sm:min-h-8 sm:text-sm"
                              >
                                Archive Board
                                <span
                                  className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2"
                                  aria-hidden="true"
                                />
                              </button>
                            </>
                          ) : null}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
            {loadState === "ready" && nextBoardCursor && (
              <div className="flex justify-center pt-5">
                <Button
                  tone="secondary"
                  onClick={() => void loadMoreBoards()}
                  disabled={loadingMoreBoards}
                >
                  {loadingMoreBoards ? "Loading..." : "Load more boards"}
                </Button>
              </div>
            )}
          </section>

          <section
            aria-labelledby="board-updates-heading"
            className="soft-shadow overflow-hidden rounded-radius-2xl bg-surface-white ring-1 ring-near-black-primary-text/7"
          >
            <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3.5">
              <div>
                <h2
                  id="board-updates-heading"
                  className="text-sm font-semibold"
                >
                  Board updates
                </h2>
                <p className="mt-0.5 text-[0.75rem] text-muted-gray">
                  Latest workspace changes
                </p>
              </div>
              <Link
                href={
                  activeWorkspace
                    ? `/app/product-studio/activity?workspaceId=${encodeURIComponent(activeWorkspace.id)}`
                    : "/app/product-studio/activity"
                }
                className="shrink-0 rounded-radius-sm text-sm font-medium text-dark-text-alt outline-none hover:text-near-black-primary-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
              >
                View all
              </Link>
            </div>

            {loadState === "loading" ? (
              <p role="status" className="px-4 py-8 text-sm text-muted-gray">
                Loading board updates…
              </p>
            ) : loadState === "error" ? (
              <p
                role="alert"
                className="px-4 py-8 text-sm text-[var(--danger)]"
              >
                Board updates are unavailable until workspace data reconnects.
              </p>
            ) : activeBoards.length > 0 ? (
              <ul role="list" className="divide-y divide-border-subtle px-4">
                {activeBoards.slice(0, 4).map((board) => (
                  <li key={board.id}>
                    <Link
                      href={`/app/product-studio/boards/${board.id}`}
                      className="flex items-start gap-3 rounded-radius-sm py-3.5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-blue-accent"
                    >
                      <div
                        aria-hidden="true"
                        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-radius-md bg-light-surface-tint text-[0.6875rem] font-semibold text-sky-blue-accent ring-1 ring-border-subtle"
                      >
                        {board.title.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-near-black-primary-text">
                          {board.title}
                        </p>
                        <p className="mt-0.5 text-[0.75rem] text-muted-gray">
                          Revision {board.revision}
                        </p>
                        <time
                          dateTime={board.updatedAt}
                          className="mt-1 block text-[0.75rem] text-muted-gray"
                        >
                          {formatDashboardDate(board.updatedAt)}
                        </time>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-sm text-muted-gray">
                Board updates will appear here after your team starts working.
              </p>
            )}
          </section>
        </div>
      </div>

      <DashboardToast message={toastMessage} />
    </WorkspaceShell>
  );
}
