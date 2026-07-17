// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  listBoardsPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/boards/client", () => ({
  archiveBoard: vi.fn(),
  createBoard: vi.fn(),
  createProject: vi.fn(),
  listBoardsPage: mocks.listBoardsPage,
  listProjects: vi.fn().mockResolvedValue([]),
  listWorkspaces: vi.fn().mockResolvedValue([]),
  restoreBoard: vi.fn(),
  updateBoardMetadata: vi.fn(),
  updateBoardPreference: vi.fn(),
  updateProjectPreference: vi.fn(),
}));

import type { BoardSummary, WorkspaceSummary } from "@/lib/boards/client";
import { WorkspaceDashboardPage } from "./workspace-dashboard-page";

const WORKSPACE_ID = "ef5a8b0c-72f1-42b2-b82c-65784d1a2f7f";
const GENERATION_ID = "740afc4d-43d8-4876-bc21-5189ad4c28ef";

const workspace = {
  id: WORKSPACE_ID,
  name: "Product team",
  role: "owner",
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: "2026-07-17T10:00:00.000Z",
} satisfies WorkspaceSummary;

function board(revision: number): BoardSummary {
  return {
    id: "0bcb645c-3e28-459e-8369-a03582185d87",
    workspaceId: WORKSPACE_ID,
    projectId: "35c44525-e990-4d4c-87b8-c76e85ea8ad5",
    projectName: "Unfiled",
    ownerId: "fba5643f-b5a4-492e-b5d2-bc21ce558085",
    title: "Product planning board",
    cover: null,
    status: "active",
    sharingPolicy: "workspace",
    revision,
    documentGenerationId: GENERATION_ID,
    role: "owner",
    favorite: false,
    pinned: false,
    lastOpenedAt: null,
    archivedAt: null,
    createdAt: "2026-07-17T10:00:00.000Z",
    updatedAt: `2026-07-17T11:5${revision}:00.000Z`,
  };
}

describe("WorkspaceDashboardPage board preview refresh", () => {
  let container: HTMLDivElement;
  let root: Root;
  let now: number;

  beforeEach(() => {
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mocks.listBoardsPage.mockResolvedValue({
      boards: [board(1)],
      nextCursor: null,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("refreshes once after returning to the tab without polling or showing revisions", async () => {
    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          workspaceId={WORKSPACE_ID}
          initialBoards={[board(1)]}
          organizationEnabled={false}
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.listBoardsPage).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      `${GENERATION_ID}.1`,
    );

    mocks.listBoardsPage.mockResolvedValueOnce({
      boards: [board(2)],
      nextCursor: null,
    });
    now += 4_000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.listBoardsPage).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      `${GENERATION_ID}.2`,
    );
    expect(container.textContent).not.toContain("Latest revision");
    expect(container.textContent).not.toContain("Revision");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(mocks.listBoardsPage).toHaveBeenCalledTimes(2);
  });
});
