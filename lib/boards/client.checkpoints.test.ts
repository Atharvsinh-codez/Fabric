import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBoardCheckpoint,
  listBoardCheckpoints,
  restoreBoardCheckpoint,
} from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const checkpoint = {
  id: "checkpoint-1",
  boardId: "board-1",
  name: "Before synthesis",
  sourceDocumentGenerationId: "generation-1",
  sourceRevision: 8,
  createdBy: "user-1",
  creatorName: "Ari Morgan",
  creatorImage: null,
  createdAt: "2026-07-13T12:00:00.000Z",
  updatedAt: "2026-07-13T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("board checkpoint client", () => {
  it("lists metadata while dropping a server snapshot or internal fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          checkpoints: [
            {
              ...checkpoint,
              document: { private: "full snapshot must stay server-side" },
              internalSecret: "must-not-leak",
            },
          ],
        }),
      ),
    );

    await expect(listBoardCheckpoints("board-1")).resolves.toEqual([checkpoint]);
  });

  it("creates a checkpoint from a name only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(
        { checkpoint: { ...checkpoint, document: { private: true } } },
        201,
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createBoardCheckpoint({ boardId: "board/one", name: "Before synthesis" }),
    ).resolves.toEqual(checkpoint);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/boards/board%2Fone/checkpoints");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      name: "Before synthesis",
    });
  });

  it("restores by board-scoped checkpoint id without sending document data", async () => {
    const restored = {
      id: "board-1",
      document: { version: 1, records: [] },
      revision: 9,
      documentGenerationId: "generation-2",
      updatedAt: "2026-07-13T12:05:00.000Z",
      role: "editor",
    } as const;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ board: { ...restored, internalSecret: "must-not-leak" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      restoreBoardCheckpoint({ boardId: "board/one", checkpointId: "checkpoint/two" }),
    ).resolves.toEqual(restored);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/boards/board%2Fone/checkpoints/checkpoint%2Ftwo/restore",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({});
  });
});
