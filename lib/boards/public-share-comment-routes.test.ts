import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  createPublicShareComment: vi.fn(),
  listPublicShareCommentThreads: vi.fn(),
}));

vi.mock("@/lib/auth/require-principal", () => ({
  requirePrincipal: mocks.requirePrincipal,
}));

vi.mock("@/lib/boards/public-share-comments", () => ({
  createPublicShareComment: mocks.createPublicShareComment,
  listPublicShareCommentThreads: mocks.listPublicShareCommentThreads,
}));

import * as commentRoute from "@/app/api/shares/[token]/comments/route";

const { GET, POST } = commentRoute;

const TOKEN = "a".repeat(43);
const USER_ID = "fba5643f-b5a4-492e-b5d2-bc21ce558085";

function routeContext(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePrincipal.mockResolvedValue({ id: USER_ID });
});

describe("public share comment routes", () => {
  it("lists the existing safe thread response for an active opaque token", async () => {
    const thread = {
      id: "thread-1",
      anchor: { nodeId: "shape-1" },
      comments: [],
    };
    mocks.listPublicShareCommentThreads.mockResolvedValue({
      permission: "commenter",
      threads: [thread],
    });

    const response = await GET(
      new Request(`https://fabric.test/api/shares/${TOKEN}/comments`),
      routeContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.listPublicShareCommentThreads).toHaveBeenCalledWith(TOKEN);
    await expect(response.json()).resolves.toEqual({
      permission: "commenter",
      threads: [thread],
    });
  });

  it("creates a token-scoped thread only for a same-origin signed-in principal", async () => {
    mocks.createPublicShareComment.mockResolvedValue({ id: "thread-1" });

    const response = await POST(
      new Request(`https://fabric.test/api/shares/${TOKEN}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://fabric.test",
        },
        body: JSON.stringify({
          kind: "thread",
          anchor: { nodeId: "shape-1" },
          body: "  Please review this.  ",
        }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expect(mocks.createPublicShareComment).toHaveBeenCalledWith({
      token: TOKEN,
      userId: USER_ID,
      comment: {
        kind: "thread",
        anchor: { nodeId: "shape-1" },
        body: "Please review this.",
      },
    });
  });

  it("supports replies but exposes no public resolution mutation", async () => {
    mocks.createPublicShareComment.mockResolvedValue({ id: "comment-2" });
    const threadId = "47310dd2-838c-4c14-b6a7-bb7322b266f5";

    const response = await POST(
      new Request(`https://fabric.test/api/shares/${TOKEN}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://fabric.test",
        },
        body: JSON.stringify({ kind: "reply", threadId, body: "Updated." }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(201);
    expect("PATCH" in commentRoute).toBe(false);
    expect(mocks.createPublicShareComment).toHaveBeenCalledWith({
      token: TOKEN,
      userId: USER_ID,
      comment: { kind: "reply", threadId, body: "Updated." },
    });
  });

  it("fails closed before authentication for cross-origin mutations", async () => {
    const response = await POST(
      new Request(`https://fabric.test/api/shares/${TOKEN}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.test",
        },
        body: JSON.stringify({ kind: "thread", anchor: {}, body: "Injected" }),
      }),
      routeContext(),
    );

    expect(response.status).toBe(403);
    expect(mocks.requirePrincipal).not.toHaveBeenCalled();
    expect(mocks.createPublicShareComment).not.toHaveBeenCalled();
  });

  it("requires authentication and hides malformed token details", async () => {
    const authenticationError = new Error("Authentication is required.");
    authenticationError.name = "AuthenticationRequiredError";
    mocks.requirePrincipal.mockRejectedValue(authenticationError);

    const unauthorized = await POST(
      new Request(`https://fabric.test/api/shares/${TOKEN}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://fabric.test",
        },
        body: JSON.stringify({ kind: "thread", anchor: {}, body: "Review" }),
      }),
      routeContext(),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.createPublicShareComment).not.toHaveBeenCalled();

    const malformed = await GET(
      new Request("https://fabric.test/api/shares/not-a-token/comments"),
      routeContext("not-a-token"),
    );
    expect(malformed.status).toBe(404);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "not_found" },
    });
  });
});
