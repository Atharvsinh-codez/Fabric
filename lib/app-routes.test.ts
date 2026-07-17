import { describe, expect, it } from "vitest";

import {
  APP_ROUTES,
  boardPath,
  dashboardPath,
  withSearchParams,
  workspaceRoutePath,
} from "./app-routes";

describe("Fabric app routes", () => {
  it("exposes the canonical workspace routes", () => {
    expect(APP_ROUTES).toEqual({
      workspaces: "/app",
      dashboard: "/app/dashboard",
      members: "/app/dashboard/members",
      activity: "/app/dashboard/activity",
      settings: "/app/dashboard/settings",
      onboarding: "/app/onboarding",
      account: "/app/account",
    });
  });

  it("builds an encoded canonical board path", () => {
    expect(boardPath("board/id with spaces")).toBe(
      "/app/boards/board%2Fid%20with%20spaces",
    );
  });

  it("adds workspace scope to workspace pages", () => {
    expect(workspaceRoutePath(APP_ROUTES.members, "workspace/id")).toBe(
      "/app/dashboard/members?workspaceId=workspace%2Fid",
    );
    expect(workspaceRoutePath(APP_ROUTES.activity)).toBe(APP_ROUTES.activity);
  });

  it("keeps dashboard filters canonical and deterministically ordered", () => {
    expect(
      dashboardPath({
        workspaceId: "workspace 1",
        q: "launch plan",
        view: "recent",
        projectId: "project/1",
        status: "review",
      }),
    ).toBe(
      "/app/dashboard?workspaceId=workspace+1&q=launch+plan&view=recent&projectId=project%2F1&status=review",
    );
    expect(dashboardPath()).toBe(APP_ROUTES.dashboard);
  });

  it("preserves arbitrary legacy deep-link query values", () => {
    expect(
      withSearchParams(APP_ROUTES.dashboard, {
        workspaceId: "workspace/id",
        panel: ["comments", "activity"],
        ignored: undefined,
      }),
    ).toBe(
      "/app/dashboard?workspaceId=workspace%2Fid&panel=comments&panel=activity",
    );
  });
});
