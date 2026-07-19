import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deleteBoard: vi.fn(),
  deleteWorkspace: vi.fn(),
  requireBoardWorkspaceRollout: vi.fn(),
  requirePrincipal: vi.fn(),
  requireWorkspaceRolloutForUser: vi.fn(),
  scheduleRealtimeRevocationDispatch: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));
vi.mock("@/lib/boards/repository", () => ({
  deleteBoard: mocks.deleteBoard,
  deleteWorkspace: mocks.deleteWorkspace,
}));
vi.mock("@/lib/realtime/schedule-revocation-dispatch", () => ({
  scheduleRealtimeRevocationDispatch:
    mocks.scheduleRealtimeRevocationDispatch,
}));
vi.mock("@/lib/rollout/workspace-rollout", () => ({
  requireBoardWorkspaceRollout: mocks.requireBoardWorkspaceRollout,
  requireWorkspaceRolloutForUser: mocks.requireWorkspaceRolloutForUser,
}));

import { DELETE as deleteBoardRoute } from "@/app/api/boards/[boardId]/delete/route";
import { DELETE as deleteWorkspaceRoute } from "@/app/api/boards/workspaces/[workspaceId]/route";
import { DeleteBoardSchema, DeleteWorkspaceSchema } from "./contracts";
import { BoardApiError } from "./http";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BOARD_ID = "22222222-2222-4222-8222-222222222222";
const GENERATION_ID = "33333333-3333-4333-8333-333333333333";
const WORKSPACE_ID = "44444444-4444-4444-8444-444444444444";
const ORIGIN = "https://fabric.test";

const boardBody = {
  expectedTitle: "Product planning board",
  expectedDocumentGenerationId: GENERATION_ID,
};
const workspaceBody = { expectedName: "Product team" };

function deletionRequest(path: string, body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}

describe("confirmed deletion routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePrincipal.mockResolvedValue({ id: USER_ID });
    mocks.requireBoardWorkspaceRollout.mockResolvedValue(undefined);
    mocks.requireWorkspaceRolloutForUser.mockResolvedValue(undefined);
  });

  it.each([
    {
      label: "board",
      call: () =>
        deleteBoardRoute(
          deletionRequest(
            `/api/boards/${BOARD_ID}/delete`,
            boardBody,
            "https://attacker.example",
          ),
          { params: Promise.resolve({ boardId: BOARD_ID }) },
        ),
    },
    {
      label: "workspace",
      call: () =>
        deleteWorkspaceRoute(
          deletionRequest(
            `/api/boards/workspaces/${WORKSPACE_ID}`,
            workspaceBody,
            "https://attacker.example",
          ),
          { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
        ),
    },
  ])("rejects a cross-origin $label deletion before authentication", async ({ call }) => {
    const response = await call();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "forbidden_origin" },
    });
    expect(mocks.requirePrincipal).not.toHaveBeenCalled();
    expect(mocks.deleteBoard).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(mocks.scheduleRealtimeRevocationDispatch).not.toHaveBeenCalled();
  });

  it("rejects invalid board identifiers and confirmation bodies", async () => {
    const invalidId = await deleteBoardRoute(
      deletionRequest("/api/boards/not-a-uuid/delete", boardBody),
      { params: Promise.resolve({ boardId: "not-a-uuid" }) },
    );
    const invalidBody = await deleteBoardRoute(
      deletionRequest(`/api/boards/${BOARD_ID}/delete`, {
        expectedTitle: boardBody.expectedTitle,
      }),
      { params: Promise.resolve({ boardId: BOARD_ID }) },
    );

    expect(invalidId.status).toBe(422);
    expect(invalidBody.status).toBe(422);
    expect(mocks.requireBoardWorkspaceRollout).not.toHaveBeenCalled();
    expect(mocks.deleteBoard).not.toHaveBeenCalled();
    expect(mocks.scheduleRealtimeRevocationDispatch).not.toHaveBeenCalled();
  });

  it("rejects invalid workspace identifiers and strict confirmation bodies", async () => {
    const invalidId = await deleteWorkspaceRoute(
      deletionRequest("/api/boards/workspaces/not-a-uuid", workspaceBody),
      { params: Promise.resolve({ workspaceId: "not-a-uuid" }) },
    );
    const invalidBody = await deleteWorkspaceRoute(
      deletionRequest(`/api/boards/workspaces/${WORKSPACE_ID}`, {
        ...workspaceBody,
        unexpected: true,
      }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
    );

    expect(invalidId.status).toBe(422);
    expect(invalidBody.status).toBe(422);
    expect(mocks.requireWorkspaceRolloutForUser).not.toHaveBeenCalled();
    expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    expect(mocks.scheduleRealtimeRevocationDispatch).not.toHaveBeenCalled();
  });

  it("keeps deletion confirmation text exact instead of trimming it", () => {
    const expectedTitle = `${boardBody.expectedTitle} `;
    const expectedName = `${workspaceBody.expectedName} `;

    expect(
      DeleteBoardSchema.parse({
        ...boardBody,
        expectedTitle,
      }).expectedTitle,
    ).toBe(expectedTitle);
    expect(DeleteWorkspaceSchema.parse({ expectedName }).expectedName).toBe(
      expectedName,
    );
  });

  it("passes whitespace-sensitive confirmations to the repositories unchanged", async () => {
    const expectedTitle = `${boardBody.expectedTitle} `;
    const expectedName = `${workspaceBody.expectedName} `;
    mocks.deleteBoard.mockResolvedValue({
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt: new Date("2026-07-19T12:28:00.000Z"),
    });
    mocks.deleteWorkspace.mockResolvedValue({
      id: WORKSPACE_ID,
      deletedAt: new Date("2026-07-19T12:29:00.000Z"),
    });

    const boardResponse = await deleteBoardRoute(
      deletionRequest(`/api/boards/${BOARD_ID}/delete`, {
        ...boardBody,
        expectedTitle,
      }),
      { params: Promise.resolve({ boardId: BOARD_ID }) },
    );
    const workspaceResponse = await deleteWorkspaceRoute(
      deletionRequest(`/api/boards/workspaces/${WORKSPACE_ID}`, {
        expectedName,
      }),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
    );

    expect(boardResponse.status).toBe(200);
    expect(workspaceResponse.status).toBe(200);
    expect(mocks.deleteBoard).toHaveBeenCalledWith({
      userId: USER_ID,
      boardId: BOARD_ID,
      expectedTitle,
      expectedDocumentGenerationId: GENERATION_ID,
    });
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      expectedName,
    });
  });

  it("deletes the exact authorized board and schedules its realtime revocation", async () => {
    const deletedAt = new Date("2026-07-19T12:30:00.000Z");
    mocks.deleteBoard.mockResolvedValue({
      id: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      deletedAt,
    });

    const response = await deleteBoardRoute(
      deletionRequest(`/api/boards/${BOARD_ID}/delete`, boardBody),
      { params: Promise.resolve({ boardId: BOARD_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: {
        id: BOARD_ID,
        workspaceId: WORKSPACE_ID,
        deletedAt: deletedAt.toISOString(),
      },
    });
    expect(mocks.requirePrincipal).toHaveBeenCalledOnce();
    expect(mocks.requireBoardWorkspaceRollout).toHaveBeenCalledWith(
      USER_ID,
      BOARD_ID,
    );
    expect(mocks.deleteBoard).toHaveBeenCalledWith({
      userId: USER_ID,
      boardId: BOARD_ID,
      ...boardBody,
    });
    expect(mocks.scheduleRealtimeRevocationDispatch).toHaveBeenCalledOnce();
  });

  it("deletes the exact authorized workspace and schedules its realtime revocations", async () => {
    const deletedAt = new Date("2026-07-19T12:31:00.000Z");
    mocks.deleteWorkspace.mockResolvedValue({
      id: WORKSPACE_ID,
      deletedAt,
    });

    const response = await deleteWorkspaceRoute(
      deletionRequest(`/api/boards/workspaces/${WORKSPACE_ID}`, workspaceBody),
      { params: Promise.resolve({ workspaceId: WORKSPACE_ID }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: {
        id: WORKSPACE_ID,
        deletedAt: deletedAt.toISOString(),
      },
    });
    expect(mocks.requirePrincipal).toHaveBeenCalledOnce();
    expect(mocks.requireWorkspaceRolloutForUser).toHaveBeenCalledWith(
      USER_ID,
      WORKSPACE_ID,
    );
    expect(mocks.deleteWorkspace).toHaveBeenCalledWith({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      ...workspaceBody,
    });
    expect(mocks.scheduleRealtimeRevocationDispatch).toHaveBeenCalledOnce();
  });

  it("does not schedule realtime work when a confirmed deletion is rejected", async () => {
    mocks.deleteBoard.mockRejectedValue(
      new BoardApiError(
        409,
        "delete_confirmation_mismatch",
        "The board changed. Review the board and confirm again.",
      ),
    );

    const response = await deleteBoardRoute(
      deletionRequest(`/api/boards/${BOARD_ID}/delete`, boardBody),
      { params: Promise.resolve({ boardId: BOARD_ID }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "delete_confirmation_mismatch" },
    });
    expect(mocks.scheduleRealtimeRevocationDispatch).not.toHaveBeenCalled();
  });
});
