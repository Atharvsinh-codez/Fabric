import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createPublicShareCommentThread,
  FabricApiError,
  listPublicShareCommentThreads,
  replyToPublicShareCommentThread,
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

describe("public share comment client", () => {
  it("loads token-scoped access and comment threads without caching", async () => {
    const access = {
      permission: "commenter",
      threads: [{ id: "thread-1", anchor: {}, comments: [] }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse(access);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPublicShareCommentThreads("token/one")).resolves.toEqual(access);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/shares/token%2Fone/comments",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("uses one public endpoint for thread and reply creation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ comment: {} }, 201);
    });
    vi.stubGlobal("fetch", fetchMock);

    await createPublicShareCommentThread({
      token: "share-token",
      anchor: { x: 10, y: 20 },
      body: "Review this.",
    });
    await replyToPublicShareCommentThread({
      token: "share-token",
      threadId: "thread-1",
      body: "Updated.",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/shares/share-token/comments");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      kind: "thread",
      anchor: { x: 10, y: 20 },
      body: "Review this.",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      kind: "reply",
      threadId: "thread-1",
      body: "Updated.",
    });
  });

  it("preserves a safe authentication error for the hook", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "unauthorized", message: "Sign in to continue." } },
          401,
        ),
      ),
    );

    await expect(
      createPublicShareCommentThread({ token: "share-token", anchor: {}, body: "Review" }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<FabricApiError>>({
        name: "FabricApiError",
        status: 401,
        code: "unauthorized",
      }),
    );
  });
});
