import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addBoardMember,
  addProjectMember,
  listBoardMembers,
  listProjectMembers,
  removeBoardMember,
  removeProjectMember,
  updateBoardMember,
  updateProjectMember,
} from "./client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const member = {
  userId: "user-1",
  role: "viewer" as const,
  name: "Ari Morgan",
  image: null,
  createdAt: "2026-07-15T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project membership client", () => {
  it("uses workspace-and-project-scoped endpoints for every membership mutation", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return jsonResponse({ members: [member] });
      if (method === "POST") return jsonResponse({ member }, 201);
      if (method === "PATCH") {
        return jsonResponse({
          member: { userId: member.userId, role: "editor", updatedAt: member.createdAt },
        });
      }
      return jsonResponse({ member: { userId: member.userId } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      listProjectMembers({ workspaceId: "workspace/one", projectId: "project/two" }),
    ).resolves.toEqual([member]);
    await addProjectMember({
      workspaceId: "workspace/one",
      projectId: "project/two",
      email: "ari@example.com",
      role: "viewer",
    });
    await updateProjectMember({
      workspaceId: "workspace/one",
      projectId: "project/two",
      userId: "user/three",
      role: "editor",
    });
    await removeProjectMember({
      workspaceId: "workspace/one",
      projectId: "project/two",
      userId: "user/three",
    });

    const base = "/api/boards/workspaces/workspace%2Fone/projects/project%2Ftwo/members";
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      base,
      base,
      `${base}/user%2Fthree`,
      `${base}/user%2Fthree`,
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "PATCH",
      "DELETE",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      email: "ari@example.com",
      role: "viewer",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ role: "editor" });
  });
});

describe("direct board membership client", () => {
  it("keeps direct grants board-scoped and sends only email or role inputs", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return jsonResponse({ members: [member] });
      if (method === "POST") return jsonResponse({ member }, 201);
      if (method === "PATCH") {
        return jsonResponse({
          member: { userId: member.userId, role: "commenter", updatedAt: member.createdAt },
        });
      }
      return jsonResponse({ member: { userId: member.userId } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(listBoardMembers("board/one")).resolves.toEqual([member]);
    await addBoardMember({ boardId: "board/one", email: "ari@example.com", role: "viewer" });
    await updateBoardMember({ boardId: "board/one", userId: "user/two", role: "commenter" });
    await removeBoardMember({ boardId: "board/one", userId: "user/two" });

    const base = "/api/boards/board%2Fone/members";
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      base,
      base,
      `${base}/user%2Ftwo`,
      `${base}/user%2Ftwo`,
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual([
      "GET",
      "POST",
      "PATCH",
      "DELETE",
    ]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      email: "ari@example.com",
      role: "viewer",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({ role: "commenter" });
  });
});
