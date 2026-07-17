import type { BoardWorkflowStatus } from "@/db/schema/product";

export const DASHBOARD_BOARD_PAGE_SIZE = 16;

export const DASHBOARD_BOARD_VIEWS = [
  "recent",
  "favorite",
  "pinned",
  "shared",
  "archived",
  "all",
] as const;

export type DashboardBoardView = (typeof DASHBOARD_BOARD_VIEWS)[number];

export const DASHBOARD_BOARD_STATUSES = [
  "draft",
  "active",
  "review",
  "approved",
] as const satisfies readonly BoardWorkflowStatus[];

export type DashboardBoardStatus = (typeof DASHBOARD_BOARD_STATUSES)[number];

export type DashboardBoardQuery = Readonly<{
  q: string;
  view: DashboardBoardView;
  projectId?: string;
  status?: DashboardBoardStatus;
}>;

export function dashboardBoardQueryKey(
  workspaceId: string | null | undefined,
  query: DashboardBoardQuery,
): string {
  return JSON.stringify([
    workspaceId ?? null,
    query.view,
    query.q,
    query.projectId ?? null,
    query.status ?? null,
  ]);
}
