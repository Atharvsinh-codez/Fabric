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

import {
  getBoardPreviewMetadata,
  getBoardPreviewSource,
  type BoardPreviewMetadata,
} from "./preview-repository";

const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";
const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const WORKSPACE_ID = "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f";
const METADATA: BoardPreviewMetadata = {
  boardId: BOARD_ID,
  workspaceId: WORKSPACE_ID,
  documentGenerationId: "740afc4d-43d8-4876-bc21-5189ad4c28ef",
  revision: 52,
};

function selectResult(rows: unknown[]) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  mocks.select.mockReturnValueOnce({ from });
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
  it("authorizes before reading version metadata and does not select the document", async () => {
    const query = selectResult([METADATA]);

    await expect(getBoardPreviewMetadata(USER_ID, BOARD_ID)).resolves.toEqual(METADATA);
    expect(mocks.requireBoardCapability).toHaveBeenCalledWith(
      USER_ID,
      BOARD_ID,
      "view",
    );
    expect(mocks.requireBoardCapability.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.select.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mocks.select).toHaveBeenCalledWith({
      boardId: expect.anything(),
      workspaceId: expect.anything(),
      documentGenerationId: expect.anything(),
      revision: expect.anything(),
    });
    expect(mocks.select.mock.calls[0]?.[0]).not.toHaveProperty("document");
    expect(query.from).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("loads the full document only from the authorized metadata scope", async () => {
    const source = {
      ...METADATA,
      document: { version: 1 as const, nodes: [], edges: [] },
    };
    const query = selectResult([source]);

    await expect(getBoardPreviewSource(METADATA)).resolves.toEqual(source);
    expect(mocks.requireBoardCapability).not.toHaveBeenCalled();
    expect(mocks.select.mock.calls[0]?.[0]).toHaveProperty("document");
    expect(query.from).toHaveBeenCalledTimes(1);
    expect(query.where).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("returns a hidden 404 when the authorized metadata row disappears", async () => {
    selectResult([]);
    await expect(getBoardPreviewMetadata(USER_ID, BOARD_ID)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("returns a hidden 404 when the scoped document row disappears", async () => {
    selectResult([]);
    await expect(getBoardPreviewSource(METADATA)).rejects.toMatchObject({
      status: 404,
      code: "not_found",
    });
  });
});
