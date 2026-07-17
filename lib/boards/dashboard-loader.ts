import "server-only";

import type { BoardSummary, ProjectSummary, WorkspaceSummary } from "@/lib/boards/client";
import {
  listBoardsPage as listStoredBoardsPage,
  listWorkspaces as listStoredWorkspaces,
} from "@/lib/boards/repository";
import { UuidSchema } from "@/lib/boards/contracts";
import {
  DASHBOARD_BOARD_PAGE_SIZE,
  DASHBOARD_BOARD_STATUSES,
  DASHBOARD_BOARD_VIEWS,
  dashboardBoardQueryKey,
  type DashboardBoardQuery,
  type DashboardBoardStatus,
  type DashboardBoardView,
} from "@/lib/boards/dashboard-query";
import { listProjects as listStoredProjects } from "@/lib/boards/organization-repository";
import { isWorkspaceRolloutEnabled } from "@/lib/rollout/workspace-rollout";

export type DashboardBootstrap = Readonly<{
  boardQuery: DashboardBoardQuery;
  boardQueryKey: string;
  boards: BoardSummary[];
  nextBoardCursor: string | null;
  organizationEnabled: boolean;
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
}>;

export type DashboardBootstrapInput = Readonly<{
  workspaceId?: string;
  q?: string;
  view?: string;
  projectId?: string;
  status?: string;
}>;

const DEFAULT_BOARD_QUERY: DashboardBoardQuery = {
  q: "",
  view: "recent",
};

function normalizeView(value: string | undefined): DashboardBoardView {
  return DASHBOARD_BOARD_VIEWS.includes(value as DashboardBoardView)
    ? (value as DashboardBoardView)
    : "recent";
}

function normalizeStatus(value: string | undefined): DashboardBoardStatus | undefined {
  return DASHBOARD_BOARD_STATUSES.includes(value as DashboardBoardStatus)
    ? (value as DashboardBoardStatus)
    : undefined;
}

function serializeBoards(
  boards: Awaited<ReturnType<typeof listStoredBoardsPage>>["boards"],
): BoardSummary[] {
  return boards.map((board) => ({
    ...board,
    lastOpenedAt: board.lastOpenedAt?.toISOString() ?? null,
    archivedAt: board.archivedAt?.toISOString() ?? null,
    createdAt: board.createdAt.toISOString(),
    updatedAt: board.updatedAt.toISOString(),
  }));
}

function serializeProjects(
  projects: Awaited<ReturnType<typeof listStoredProjects>>,
): ProjectSummary[] {
  return projects.map((project) => ({
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }));
}

function serializeWorkspaces(
  workspaces: Awaited<ReturnType<typeof listStoredWorkspaces>>,
): WorkspaceSummary[] {
  return workspaces.map((workspace) => ({
    ...workspace,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  }));
}

export async function loadWorkspaceBootstrap(userId: string): Promise<WorkspaceSummary[]> {
  return serializeWorkspaces(await listStoredWorkspaces(userId));
}

export async function loadDashboardBootstrap(
  userId: string,
  input: DashboardBootstrapInput = {},
): Promise<DashboardBootstrap> {
  const storedWorkspaces = await listStoredWorkspaces(userId);
  const activeWorkspace =
    storedWorkspaces.find((workspace) => workspace.id === input.workspaceId) ??
    storedWorkspaces[0] ??
    null;
  const organizationEnabled = Boolean(
    activeWorkspace && isWorkspaceRolloutEnabled(activeWorkspace.id),
  );
  if (!activeWorkspace) {
    return {
      boardQuery: DEFAULT_BOARD_QUERY,
      boardQueryKey: dashboardBoardQueryKey(null, DEFAULT_BOARD_QUERY),
      boards: [],
      nextBoardCursor: null,
      organizationEnabled: false,
      projects: [],
      workspaces: serializeWorkspaces(storedWorkspaces),
    };
  }

  const requestedProjectId = UuidSchema.safeParse(input.projectId);
  const requestedQuery: DashboardBoardQuery = organizationEnabled
    ? {
        q: input.q?.trim().slice(0, 160) ?? "",
        view: normalizeView(input.view),
        projectId: requestedProjectId.success ? requestedProjectId.data : undefined,
        status: normalizeStatus(input.status),
      }
    : DEFAULT_BOARD_QUERY;

  const projectsPromise = organizationEnabled
    ? listStoredProjects({ userId, workspaceId: activeWorkspace.id })
    : Promise.resolve([]);
  let storedProjects: Awaited<ReturnType<typeof listStoredProjects>>;
  let boardQuery = requestedQuery;
  let boardPage: Awaited<ReturnType<typeof listStoredBoardsPage>>;

  if (requestedQuery.projectId) {
    storedProjects = await projectsPromise;
    boardQuery = storedProjects.some((project) => project.id === requestedQuery.projectId)
      ? requestedQuery
      : { ...requestedQuery, projectId: undefined };
    boardPage = await listStoredBoardsPage({
      userId,
      workspaceId: activeWorkspace.id,
      view: boardQuery.view,
      q: boardQuery.q || undefined,
      projectId: boardQuery.projectId,
      status: boardQuery.status,
      limit: DASHBOARD_BOARD_PAGE_SIZE,
    });
  } else {
    [boardPage, storedProjects] = await Promise.all([
      listStoredBoardsPage({
        userId,
        workspaceId: activeWorkspace.id,
        view: boardQuery.view,
        q: boardQuery.q || undefined,
        status: boardQuery.status,
        limit: DASHBOARD_BOARD_PAGE_SIZE,
      }),
      projectsPromise,
    ]);
  }

  return {
    boardQuery,
    boardQueryKey: dashboardBoardQueryKey(activeWorkspace.id, boardQuery),
    boards: serializeBoards(boardPage.boards),
    nextBoardCursor: boardPage.nextCursor,
    organizationEnabled,
    projects: serializeProjects(storedProjects),
    workspaces: serializeWorkspaces(storedWorkspaces),
  };
}
