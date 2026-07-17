import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBoardsPage: vi.fn(),
  listProjects: vi.fn(),
  listWorkspaces: vi.fn(),
  rolloutEnabled: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/boards/repository", () => ({
  listBoardsPage: mocks.listBoardsPage,
  listWorkspaces: mocks.listWorkspaces,
}));

vi.mock("@/lib/boards/organization-repository", () => ({
  listProjects: mocks.listProjects,
}));

vi.mock("@/lib/rollout/workspace-rollout", () => ({
  isWorkspaceRolloutEnabled: mocks.rolloutEnabled,
}));

import { dashboardBoardQueryKey } from "@/lib/boards/dashboard-query";
import { loadDashboardBootstrap } from "@/lib/boards/dashboard-loader";

const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";
const WORKSPACE_ID = "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f";
const PROJECT_ID = "35c44525-e990-4d4c-87b8-c76e85ea8ad5";

const workspace = {
  id: WORKSPACE_ID,
  name: "Product team",
  role: "owner",
  createdAt: new Date("2026-07-17T10:00:00.000Z"),
  updatedAt: new Date("2026-07-17T10:00:00.000Z"),
};

const project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: "Roadmap",
  icon: "folder",
  defaultSharingPolicy: "workspace",
  isDefault: false,
  pinnedAt: null,
  pinned: false,
  createdAt: new Date("2026-07-17T10:00:00.000Z"),
  updatedAt: new Date("2026-07-17T10:00:00.000Z"),
};

const board = {
  id: "0bcb645c-3e28-459e-8369-a03582185d87",
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  projectName: "Roadmap",
  ownerId: USER_ID,
  title: "Product planning board",
  cover: null,
  status: "review",
  sharingPolicy: "workspace",
  revision: 2,
  documentGenerationId: "740afc4d-43d8-4876-bc21-5189ad4c28ef",
  role: "owner",
  favorite: true,
  pinned: false,
  lastOpenedAt: null,
  archivedAt: null,
  createdAt: new Date("2026-07-17T10:00:00.000Z"),
  updatedAt: new Date("2026-07-17T11:50:00.000Z"),
};

describe("loadDashboardBootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listWorkspaces.mockResolvedValue([workspace]);
    mocks.listProjects.mockResolvedValue([project]);
    mocks.listBoardsPage.mockResolvedValue({
      boards: [board],
      nextCursor: "next-board-page",
    });
    mocks.rolloutEnabled.mockReturnValue(true);
  });

  it("loads the exact server-filtered first page and returns its cursor and query key", async () => {
    const result = await loadDashboardBootstrap(USER_ID, {
      workspaceId: WORKSPACE_ID,
      q: "  planning  ",
      view: "favorite",
      projectId: PROJECT_ID,
      status: "review",
    });

    expect(mocks.listBoardsPage).toHaveBeenCalledOnce();
    expect(mocks.listBoardsPage).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      view: "favorite",
      q: "planning",
      projectId: PROJECT_ID,
      status: "review",
      limit: 16,
    });
    expect(result.boardQuery).toEqual({
      q: "planning",
      view: "favorite",
      projectId: PROJECT_ID,
      status: "review",
    });
    expect(result.boardQueryKey).toBe(
      dashboardBoardQueryKey(WORKSPACE_ID, result.boardQuery),
    );
    expect(result.nextBoardCursor).toBe("next-board-page");
    expect(result.boards[0]?.updatedAt).toBe("2026-07-17T11:50:00.000Z");
  });

  it("keeps the legacy recent view when organization rollout is disabled", async () => {
    mocks.rolloutEnabled.mockReturnValue(false);

    const result = await loadDashboardBootstrap(USER_ID, {
      workspaceId: WORKSPACE_ID,
      q: "planning",
      view: "archived",
      projectId: PROJECT_ID,
      status: "review",
    });

    expect(mocks.listProjects).not.toHaveBeenCalled();
    expect(mocks.listBoardsPage).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      view: "recent",
      q: undefined,
      status: undefined,
      limit: 16,
    });
    expect(result.boardQuery).toEqual({ q: "", view: "recent" });
  });
});
