import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  createBoard: vi.fn(),
  listBoardsPage: vi.fn(),
  listWorkspaceActivity: vi.fn(),
  requireWorkspaceRolloutForUser: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));

vi.mock("@/lib/boards/repository", () => ({
  createBoard: mocks.createBoard,
  listBoardsPage: mocks.listBoardsPage,
}));

vi.mock("@/lib/boards/activity", () => ({
  listWorkspaceActivity: mocks.listWorkspaceActivity,
}));

vi.mock("@/lib/rollout/workspace-rollout", () => ({
  requireWorkspaceRolloutForUser: mocks.requireWorkspaceRolloutForUser,
}));

import {
  GET as listBoardsGET,
  POST as createBoardPOST,
} from "@/app/api/boards/route";
import { GET as activityGET } from "@/app/api/boards/workspaces/[workspaceId]/activity/route";

const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";
const WORKSPACE_ID = "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePrincipal.mockResolvedValue({ id: USER_ID });
  mocks.requireWorkspaceRolloutForUser.mockResolvedValue(undefined);
});

describe("bounded board pagination routes", () => {
  it("passes a validated creation theme to board storage", async () => {
    mocks.createBoard.mockResolvedValue({ id: "board-1", theme: "grid" });

    const response = await createBoardPOST(
      new Request("https://fabric.test/api/boards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://fabric.test",
        },
        body: JSON.stringify({
          workspaceId: WORKSPACE_ID,
          title: "Planning board",
          theme: "grid",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createBoard).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      title: "Planning board",
      theme: "grid",
    });
  });

  it("passes board cursors through and returns a backward-compatible page", async () => {
    mocks.listBoardsPage.mockResolvedValue({
      boards: [{ id: "board-1" }],
      nextCursor: "next-board-page",
    });

    const response = await listBoardsGET(
      new Request(
        `https://fabric.test/api/boards?workspaceId=${WORKSPACE_ID}&view=all&cursor=current-board-page&limit=25`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.listBoardsPage).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      view: "all",
      q: undefined,
      projectId: undefined,
      status: undefined,
      cursor: "current-board-page",
      limit: 25,
    });
    await expect(response.json()).resolves.toEqual({
      boards: [{ id: "board-1" }],
      nextCursor: "next-board-page",
    });
  });

  it("rejects oversized board pages before querying storage", async () => {
    const response = await listBoardsGET(
      new Request(
        `https://fabric.test/api/boards?workspaceId=${WORKSPACE_ID}&limit=101`,
      ),
    );

    expect(response.status).toBe(422);
    expect(mocks.listBoardsPage).not.toHaveBeenCalled();
  });

  it("uses an opaque compound activity cursor instead of a timestamp", async () => {
    mocks.listWorkspaceActivity.mockResolvedValue({
      items: [],
      nextCursor: "next-activity-page",
    });

    const response = await activityGET(
      new Request(
        `https://fabric.test/api/boards/workspaces/${WORKSPACE_ID}/activity?cursor=current-activity-page&limit=20`,
      ),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.listWorkspaceActivity).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      cursor: "current-activity-page",
      limit: 20,
    });
    await expect(response.json()).resolves.toEqual({
      activity: { items: [], nextCursor: "next-activity-page" },
    });
  });
});
