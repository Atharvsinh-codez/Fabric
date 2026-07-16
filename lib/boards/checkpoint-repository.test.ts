import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBoardCapability: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/clients/web", () => ({
  db: { transaction: mocks.transaction },
}));
vi.mock("@/lib/boards/authorization", () => ({
  requireBoardCapability: mocks.requireBoardCapability,
}));

import {
  createBoardCheckpoint,
  restoreBoardCheckpoint,
} from "./checkpoint-repository";

const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const CHECKPOINT_ID = "47310dd2-838c-4c14-b6a7-bb7322b266f5";
const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";

function lockingSelect(rows: unknown[]) {
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

function limitedSelect(rows: unknown[], withJoin = false) {
  const limit = vi.fn(async () => rows);
  const where = vi.fn(() => ({ limit }));
  return {
    limit,
    query: {
      from: vi.fn(() =>
        withJoin
          ? { innerJoin: vi.fn(() => ({ where })) }
          : { where },
      ),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireBoardCapability.mockResolvedValue({ role: "editor", workspaceId: "workspace-1" });
});

describe("board checkpoint repository", () => {
  it("captures the locked server document instead of accepting a client snapshot", async () => {
    const authoritativeDocument = { version: 1, records: [{ id: "server-note" }] };
    const lock = lockingSelect([
      {
        document: authoritativeDocument,
        documentGenerationId: "740afc4d-43d8-4876-bc21-5189ad4c28ef",
        revision: 8,
      },
    ]);
    const avatarContentHash = "a".repeat(64);
    const createdRow = {
      id: CHECKPOINT_ID,
      boardId: BOARD_ID,
      name: "Milestone",
      sourceRevision: 8,
      creatorAvatar: {
        id: USER_ID,
        image: "https://oauth.example/avatar.png",
        avatarObjectKey: `avatars/${USER_ID}/ready`,
        avatarContentHash,
      },
    };
    const metadata = limitedSelect([createdRow], true);
    const insertValues = vi.fn(() => ({
      returning: vi.fn(async () => [{ id: CHECKPOINT_ID }]),
    }));
    const transaction = {
      select: vi.fn()
        .mockReturnValueOnce(lock.query)
        .mockReturnValueOnce(metadata.query),
      insert: vi.fn(() => ({ values: insertValues })),
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));

    await expect(
      createBoardCheckpoint({ userId: USER_ID, boardId: BOARD_ID, name: "Milestone" }),
    ).resolves.toEqual({
      id: CHECKPOINT_ID,
      boardId: BOARD_ID,
      name: "Milestone",
      sourceRevision: 8,
      creatorImage: `/api/users/${USER_ID}/avatar?v=${avatarContentHash}`,
    });

    expect(mocks.requireBoardCapability).toHaveBeenCalledWith(USER_ID, BOARD_ID, "edit_board");
    expect(lock.forUpdate).toHaveBeenCalledWith("update");
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId: BOARD_ID,
        name: "Milestone",
        document: authoritativeDocument,
        sourceRevision: 8,
        createdBy: USER_ID,
      }),
    );
  });

  it("restores a board-scoped snapshot and rotates its document generation", async () => {
    const previousGenerationId = "740afc4d-43d8-4876-bc21-5189ad4c28ef";
    const lock = lockingSelect([
      {
        id: BOARD_ID,
        workspaceId: "workspace-1",
        documentGenerationId: previousGenerationId,
      },
    ]);
    const checkpoint = limitedSelect([{ document: { version: 1, restored: true } }]);
    const restored = {
      id: BOARD_ID,
      document: { version: 1, restored: true },
      revision: 9,
      documentGenerationId: "35c44525-e990-4d4c-87b8-c76e85ea8ad5",
      updatedAt: new Date("2026-07-13T12:05:00.000Z"),
    };
    const updateValues = vi.fn((values: Record<string, unknown>) => {
      void values;
      return {
        where: vi.fn(() => ({ returning: vi.fn(async () => [restored]) })),
      };
    });
    const revocationValues = vi.fn(async () => undefined);
    const transaction = {
      select: vi.fn()
        .mockReturnValueOnce(lock.query)
        .mockReturnValueOnce(checkpoint.query),
      update: vi.fn(() => ({ set: updateValues })),
      insert: vi.fn(() => ({ values: revocationValues })),
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));

    await expect(
      restoreBoardCheckpoint({
        userId: USER_ID,
        boardId: BOARD_ID,
        checkpointId: CHECKPOINT_ID,
      }),
    ).resolves.toEqual({ ...restored, role: "editor" });

    expect(lock.forUpdate).toHaveBeenCalledWith("update");
    const values = updateValues.mock.calls[0]?.[0];
    expect(values).toEqual(
      expect.objectContaining({
        document: { version: 1, restored: true },
        documentGenerationId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        updatedAt: expect.any(Date),
      }),
    );
    expect(values?.revision).toBeDefined();
    expect(revocationValues).toHaveBeenCalledWith({
      eventType: "board.generation_replaced",
      scope: "board",
      workspaceId: "workspace-1",
      boardId: BOARD_ID,
      documentGenerationId: previousGenerationId,
    });
  });

  it("returns a safe 404 and does not update when the checkpoint is outside the board", async () => {
    const lock = lockingSelect([{ id: BOARD_ID }]);
    const missingCheckpoint = limitedSelect([]);
    const update = vi.fn();
    const transaction = {
      select: vi.fn()
        .mockReturnValueOnce(lock.query)
        .mockReturnValueOnce(missingCheckpoint.query),
      update,
    };
    mocks.transaction.mockImplementation(async (operation) => operation(transaction));

    await expect(
      restoreBoardCheckpoint({
        userId: USER_ID,
        boardId: BOARD_ID,
        checkpointId: CHECKPOINT_ID,
      }),
    ).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(update).not.toHaveBeenCalled();
  });
});
