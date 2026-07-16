import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/clients/web", () => ({
  db: { transaction: mocks.transaction },
}));

import { createPublicShareComment } from "./public-share-comments";

const TOKEN = "a".repeat(43);
const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";

function lockingShareSelect(rows: unknown[]) {
  const forUpdate = vi.fn(async () => rows);
  const where = vi.fn(() => ({ for: forUpdate }));
  return {
    forUpdate,
    query: {
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({ where })),
      })),
    },
  };
}

function lockingThreadSelect(rows: unknown[]) {
  const forUpdate = vi.fn(async () => rows);
  return {
    forUpdate,
    query: {
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: forUpdate })),
      })),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("public share comment repository", () => {
  it("locks the active commenter link and board before inserting a thread", async () => {
    const share = lockingShareSelect([{ boardId: BOARD_ID }]);
    const insertedThread = { id: "thread-1", boardId: BOARD_ID };
    const insertedComment = { id: "comment-1", threadId: "thread-1" };
    const threadValues = vi.fn(() => ({
      returning: vi.fn(async () => [insertedThread]),
    }));
    const commentValues = vi.fn(() => ({
      returning: vi.fn(async () => [insertedComment]),
    }));
    const transaction = {
      select: vi.fn(() => share.query),
      insert: vi.fn()
        .mockReturnValueOnce({ values: threadValues })
        .mockReturnValueOnce({ values: commentValues }),
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));

    await expect(
      createPublicShareComment({
        token: TOKEN,
        userId: USER_ID,
        comment: { kind: "thread", anchor: { nodeId: "shape-1" }, body: "Review" },
      }),
    ).resolves.toEqual({ ...insertedThread, comments: [insertedComment] });

    expect(share.forUpdate).toHaveBeenCalledWith("update");
    expect(threadValues).toHaveBeenCalledWith({
      boardId: BOARD_ID,
      anchor: { nodeId: "shape-1" },
      createdBy: USER_ID,
    });
    expect(commentValues).toHaveBeenCalledWith({
      threadId: "thread-1",
      authorId: USER_ID,
      body: "Review",
    });
  });

  it("does not insert after an inactive, expired, revoked, or non-commenter lookup", async () => {
    const share = lockingShareSelect([]);
    const transaction = {
      select: vi.fn(() => share.query),
      insert: vi.fn(),
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));

    await expect(
      createPublicShareComment({
        token: TOKEN,
        userId: USER_ID,
        comment: { kind: "thread", anchor: {}, body: "Review" },
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(share.forUpdate).toHaveBeenCalledWith("update");
    expect(transaction.insert).not.toHaveBeenCalled();
  });

  it("locks a board-scoped unresolved thread before replying", async () => {
    const share = lockingShareSelect([{ boardId: BOARD_ID }]);
    const thread = lockingThreadSelect([{ id: "thread-1", resolvedAt: null }]);
    const commentValues = vi.fn(() => ({
      returning: vi.fn(async () => [{ id: "comment-2", threadId: "thread-1" }]),
    }));
    const updateWhere = vi.fn(async () => undefined);
    const transaction = {
      select: vi.fn()
        .mockReturnValueOnce(share.query)
        .mockReturnValueOnce(thread.query),
      insert: vi.fn(() => ({ values: commentValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: updateWhere })),
      })),
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));

    await createPublicShareComment({
      token: TOKEN,
      userId: USER_ID,
      comment: { kind: "reply", threadId: "thread-1", body: "Updated" },
    });

    expect(share.forUpdate).toHaveBeenCalledWith("update");
    expect(thread.forUpdate).toHaveBeenCalledWith("update");
    expect(commentValues).toHaveBeenCalledWith({
      threadId: "thread-1",
      authorId: USER_ID,
      body: "Updated",
    });
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});
