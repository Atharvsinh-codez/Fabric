import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const asset = {
    id: "22222222-2222-4222-8222-222222222222",
    boardId: "11111111-1111-4111-8111-111111111111",
    mimeType: "image/png",
    byteSize: 4,
    contentHash: "a".repeat(64),
    content: new Uint8Array([137, 80, 78, 71]),
    storageState: "postgres_only" as const,
    r2ObjectKey: null,
  };
  const limit = vi.fn(async () => [asset]);
  const where = vi.fn(() => ({ limit }));
  // Deliberately has no innerJoin method. Member media reads are authorized by
  // requireBoardCapability and must not add an active-board-only SQL join.
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { asset, from, limit, select, where };
});

const requireBoardCapability = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("server-only", () => ({}));
vi.mock("@/db/clients/web", () => ({ db: { select: database.select } }));
vi.mock("@/lib/boards/authorization", () => ({ requireBoardCapability }));

import { getBoardAsset } from "./repository";

describe("authenticated board asset reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps persisted media readable when an authorized board is archived", async () => {
    await expect(
      getBoardAsset({
        userId: "33333333-3333-4333-8333-333333333333",
        boardId: database.asset.boardId,
        storageId: database.asset.id,
      }),
    ).resolves.toEqual(database.asset);

    expect(requireBoardCapability).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      database.asset.boardId,
      "view",
    );
    expect(database.from).toHaveBeenCalledOnce();
    expect(database.where).toHaveBeenCalledOnce();
    expect(database.limit).toHaveBeenCalledWith(1);
  });
});
