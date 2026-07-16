import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBoardCommentThread,
  createBoardShareLink,
  listBoardCommentThreads,
  listBoardShareLinks,
  replyToBoardCommentThread,
  revokeBoardShareLink,
  setBoardCommentThreadResolution,
} from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("board comment client", () => {
  it("loads durable threads and preserves their node anchors", async () => {
    const thread = {
      id: "thread-1",
      anchor: { nodeId: "node-1" },
      createdBy: "user-1",
      creatorName: "Ari Morgan",
      creatorImage: null,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: "2026-07-13T12:00:00.000Z",
      updatedAt: "2026-07-13T12:00:00.000Z",
      comments: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ threads: [thread] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBoardCommentThreads("board/one")).resolves.toEqual([thread]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/boards/board%2Fone/comments",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("sends thread, reply, and resolution mutations to their scoped endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ comment: {} }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createBoardCommentThread({ boardId: "board-1", anchor: { nodeId: "node-1" }, body: "Review this." });
    await replyToBoardCommentThread({ boardId: "board-1", threadId: "thread-1", body: "Updated." });
    await setBoardCommentThreadResolution({ boardId: "board-1", threadId: "thread-1", resolved: true });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      kind: "thread",
      anchor: { nodeId: "node-1" },
      body: "Review this.",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      kind: "reply",
      threadId: "thread-1",
      body: "Updated.",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/boards/board-1/comments/thread-1");
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("PATCH");
  });
});

describe("board share-link client", () => {
  it("lists redacted link metadata without requiring a reusable token", async () => {
    const link = {
      id: "link-1",
      permission: "viewer",
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: "2026-07-13T12:00:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ links: [{ ...link, tokenHash: "must-not-leak" }] })));

    await expect(listBoardShareLinks("board-1")).resolves.toEqual([link]);
  });

  it("returns the raw path only from creation and revokes by opaque link id", async () => {
    let requestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      requestCount += 1;
      return requestCount === 1
        ? jsonResponse({
            link: {
              id: "link-1",
              permission: "commenter",
              expiresAt: null,
              createdAt: "2026-07-13T12:00:00.000Z",
              path: "/share/one-time-private-token",
              token: "one-time-private-token",
            },
          }, 201)
        : jsonResponse({ link: { id: "link-1", revokedAt: "2026-07-13T12:05:00.000Z" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createBoardShareLink({ boardId: "board-1", permission: "commenter", expiresAt: null })).resolves.toEqual({
      id: "link-1",
      permission: "commenter",
      expiresAt: null,
      createdAt: "2026-07-13T12:00:00.000Z",
      path: "/share/one-time-private-token",
    });
    await revokeBoardShareLink({ boardId: "board-1", linkId: "link-1" });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ permission: "commenter", expiresAt: null });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/boards/board-1/share-links/link-1");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
  });
});
