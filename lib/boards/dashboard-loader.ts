import "server-only";

import type { BoardSummary, ProjectSummary, WorkspaceSummary } from "@/lib/boards/client";
import {
  listBoards as listStoredBoards,
  listWorkspaces as listStoredWorkspaces,
} from "@/lib/boards/repository";
import { listProjects as listStoredProjects } from "@/lib/boards/organization-repository";
import { isWorkspaceRolloutEnabled } from "@/lib/rollout/workspace-rollout";

export type DashboardBootstrap = Readonly<{
  boards: BoardSummary[];
  organizationEnabled: boolean;
  projects: ProjectSummary[];
  workspaces: WorkspaceSummary[];
}>;

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
  requestedWorkspaceId?: string,
): Promise<DashboardBootstrap> {
  const storedWorkspaces = await listStoredWorkspaces(userId);
  const activeWorkspace =
    storedWorkspaces.find((workspace) => workspace.id === requestedWorkspaceId) ??
    storedWorkspaces[0] ??
    null;
  const organizationEnabled = Boolean(
    activeWorkspace && isWorkspaceRolloutEnabled(activeWorkspace.id),
  );
  const [boards, projects] = activeWorkspace
    ? await Promise.all([
        listStoredBoards({
          userId,
          workspaceId: activeWorkspace.id,
          view: "recent",
        }),
        organizationEnabled
          ? listStoredProjects({ userId, workspaceId: activeWorkspace.id })
          : Promise.resolve([]),
      ])
    : [[], []];

  return {
    boards: boards.map((board) => ({
      ...board,
      lastOpenedAt: board.lastOpenedAt?.toISOString() ?? null,
      archivedAt: board.archivedAt?.toISOString() ?? null,
      createdAt: board.createdAt.toISOString(),
      updatedAt: board.updatedAt.toISOString(),
    })),
    organizationEnabled,
    projects: projects.map((project) => ({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })),
    workspaces: serializeWorkspaces(storedWorkspaces),
  };
}
