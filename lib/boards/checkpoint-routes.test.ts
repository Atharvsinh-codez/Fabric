import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  listBoardCheckpoints: vi.fn(),
  createBoardCheckpoint: vi.fn(),
  restoreBoardCheckpoint: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));

vi.mock("@/lib/boards/checkpoint-repository", () => ({
  listBoardCheckpoints: mocks.listBoardCheckpoints,
  createBoardCheckpoint: mocks.createBoardCheckpoint,
  restoreBoardCheckpoint: mocks.restoreBoardCheckpoint,
}));

import { GET, POST } from "@/app/api/boards/[boardId]/checkpoints/route";
import { POST as restorePOST } from "@/app/api/boards/[boardId]/checkpoints/[checkpointId]/restore/route";

const BOARD_ID = "0bcb645c-3e28-459e-8369-a03582185d87";
const CHECKPOINT_ID = "47310dd2-838c-4c14-b6a7-bb7322b266f5";
const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";

function routeContext(boardId = BOARD_ID) {
  return { params: Promise.resolve({ boardId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePrincipal.mockResolvedValue({ id: USER_ID });
});

describe("board checkpoint routes", () => {
  it("lists checkpoint metadata for the authenticated principal with no-store headers", async () => {
    mocks.listBoardCheckpoints.mockResolvedValue([{ id: CHECKPOINT_ID, name: "Milestone" }]);

    const response = await GET(
      new Request(`https://fabric.test/api/boards/${BOARD_ID}/checkpoints`),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.listBoardCheckpoints).toHaveBeenCalledWith(USER_ID, BOARD_ID);
    await expect(response.json()).resolves.toEqual({
      checkpoints: [{ id: CHECKPOINT_ID, name: "Milestone" }],
    });
  });

  it("creates from a normalized name and rejects client snapshot injection", async () => {
    mocks.createBoardCheckpoint.mockResolvedValue({ id: CHECKPOINT_ID, name: "Milestone" });

    const accepted = await POST(
      new Request(`https://fabric.test/api/boards/${BOARD_ID}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://fabric.test" },
        body: JSON.stringify({ name: "  Milestone  " }),
      }),
      routeContext(),
    );
    expect(accepted.status).toBe(201);
    expect(mocks.createBoardCheckpoint).toHaveBeenCalledWith({
      userId: USER_ID,
      boardId: BOARD_ID,
      name: "Milestone",
    });

    const rejected = await POST(
      new Request(`https://fabric.test/api/boards/${BOARD_ID}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://fabric.test" },
        body: JSON.stringify({ name: "Injected", document: { version: 1 } }),
      }),
      routeContext(),
    );
    expect(rejected.status).toBe(422);
    expect(mocks.createBoardCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("fails checkpoint mutations closed without a same-origin signal", async () => {
    const response = await POST(
      new Request(`https://fabric.test/api/boards/${BOARD_ID}/checkpoints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Milestone" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(mocks.requirePrincipal).not.toHaveBeenCalled();
    expect(mocks.createBoardCheckpoint).not.toHaveBeenCalled();
  });

  it("scopes restore to both the route board and checkpoint ids", async () => {
    mocks.restoreBoardCheckpoint.mockResolvedValue({
      id: BOARD_ID,
      revision: 9,
      documentGenerationId: "20269848-ec36-4163-b19e-16b1ef382dc2",
    });

    const response = await restorePOST(
      new Request(
        `https://fabric.test/api/boards/${BOARD_ID}/checkpoints/${CHECKPOINT_ID}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: "https://fabric.test" },
          body: JSON.stringify({}),
        },
      ),
      { params: Promise.resolve({ boardId: BOARD_ID, checkpointId: CHECKPOINT_ID }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.restoreBoardCheckpoint).toHaveBeenCalledWith({
      userId: USER_ID,
      boardId: BOARD_ID,
      checkpointId: CHECKPOINT_ID,
    });
  });
});
