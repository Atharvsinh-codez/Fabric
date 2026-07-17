import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBoardCapability: vi.fn(),
  select: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/clients/web", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/boards/authorization", () => ({
  requireBoardCapability: mocks.requireBoardCapability,
}));

import { getBoardPreviewSource } from "./preview-repository";

const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";
const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const WORKSPACE_ID = "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f";

function selectResult(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  mocks.select.mockReturnValue({ from });
  return { from, where, limit };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireBoardCapability.mockResolvedValue({
    role: "viewer",
    workspaceId: WORKSPACE_ID,
  });
});

describe("board preview repository", () => {
  it("authorizes view access and reads only the resolver-scoped durable source", async () => {
    const source = {
      boardId: BOARD_ID,
      workspaceId: WORKSPACE_ID,
      document: { version: 1, nodes: [], edges: [] },
      documentGenerationId: "740afc4d-43d8-4876-bc21-5189ad4c28ef",
      revision: 52,
    };
    const query = selectResult([source]);

    await expect(getBoardPreviewSource(USER_ID, BOARD_ID)).resolves.toEqual(source);
    expect(mocks.requireBoardCapability).toHaveBeenCalledWith(
      USER_ID,
      BOARD_ID,
      "view",
    );
    expect(query.from).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("returns a hidden 404 when the scoped board row disappears", async () => {
    selectResult([]);
    await expect(getBoardPreviewSource(USER_ID, BOARD_ID)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});
