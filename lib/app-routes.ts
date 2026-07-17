export const APP_ROUTES = {
  workspaces: "/app",
  dashboard: "/app/dashboard",
  members: "/app/dashboard/members",
  activity: "/app/dashboard/activity",
  settings: "/app/dashboard/settings",
  onboarding: "/app/onboarding",
  account: "/app/account",
} as const;

export type WorkspaceAppRoute =
  | typeof APP_ROUTES.dashboard
  | typeof APP_ROUTES.members
  | typeof APP_ROUTES.activity
  | typeof APP_ROUTES.settings;

export type DashboardRouteQuery = Readonly<{
  workspaceId?: string | null;
  q?: string | null;
  view?: string | null;
  projectId?: string | null;
  status?: string | null;
}>;

export type RouteSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function appendQueryValue(params: URLSearchParams, key: string, value?: string | null): void {
  if (value) params.set(key, value);
}

function appendQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function withSearchParams(path: string, searchParams: RouteSearchParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") {
      params.append(key, value);
      continue;
    }
    value?.forEach((entry) => params.append(key, entry));
  }
  return appendQuery(path, params);
}

export function boardPath(boardId: string): `/app/boards/${string}` {
  return `/app/boards/${encodeURIComponent(boardId)}`;
}

export function workspaceRoutePath(
  route: WorkspaceAppRoute,
  workspaceId?: string | null,
): string {
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", workspaceId);
  return appendQuery(route, params);
}

export function dashboardPath(query: DashboardRouteQuery = {}): string {
  const params = new URLSearchParams();
  appendQueryValue(params, "workspaceId", query.workspaceId);
  appendQueryValue(params, "q", query.q);
  appendQueryValue(params, "view", query.view);
  appendQueryValue(params, "projectId", query.projectId);
  appendQueryValue(params, "status", query.status);
  return appendQuery(APP_ROUTES.dashboard, params);
}
