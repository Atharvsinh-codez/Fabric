import { afterEach, describe, expect, it, vi } from "vitest";

import { submitOnboarding } from "./client";

describe("submitOnboarding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the selected first-board theme", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          workspace: { id: "workspace-1", name: "Study", role: "owner" },
          board: {
            id: "board-1",
            workspaceId: "workspace-1",
            title: "Revision board",
            revision: 0,
            documentGenerationId: "generation-1",
            role: "owner",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitOnboarding({
      displayName: "Jordan",
      workspaceName: "Study",
      boardTitle: "Revision board",
      theme: "sand",
      document: { version: 1, nodes: [], edges: [] },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({ theme: "sand" });
  });
});
