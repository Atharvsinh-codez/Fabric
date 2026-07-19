// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  createBoard: vi.fn(),
  deleteBoard: vi.fn(),
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
  WorkspaceShell: ({
    action,
    children,
  }: {
    action?: ReactNode;
    children: ReactNode;
  }) => <div>{action}{children}</div>,
}));
vi.mock("@/components/fabric-whiteboard/fabric-dialog", () => ({
  FabricDialog: ({
    open,
    title,
    description,
    children,
  }: {
    open: boolean;
    title: string;
    description?: string;
    children: ReactNode;
  }) => open ? (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ) : null,
}));
vi.mock("@/lib/boards/client", () => ({
  archiveBoard: vi.fn(),
  createBoard: mocks.createBoard,
  createProject: vi.fn(),
  deleteBoard: mocks.deleteBoard,
  listBoardsPage: mocks.listBoardsPage,
  listProjects: vi.fn().mockResolvedValue([]),
  listWorkspaces: vi.fn().mockResolvedValue([]),
  restoreBoard: vi.fn(),
  updateBoardMetadata: vi.fn(),
  updateBoardPreference: vi.fn(),
  updateProjectPreference: vi.fn(),
}));

import type { BoardSummary, WorkspaceSummary } from "@/lib/boards/client";
import { dashboardBoardQueryKey } from "@/lib/boards/dashboard-query";
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
    vi.clearAllMocks();
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
    mocks.createBoard.mockResolvedValue(board(1));
    mocks.deleteBoard.mockResolvedValue({
      id: board(1).id,
      workspaceId: WORKSPACE_ID,
      deletedAt: "2026-07-19T12:00:00.000Z",
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

  it("uses the server bootstrap without a duplicate mount request and refreshes when stale", async () => {
    const initialBoardQueryKey = dashboardBoardQueryKey(WORKSPACE_ID, {
      q: "",
      view: "recent",
    });
    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          key={initialBoardQueryKey}
          workspaceId={WORKSPACE_ID}
          initialBoards={[board(1)]}
          initialBoardQueryKey={initialBoardQueryKey}
          initialNextBoardCursor={null}
          organizationEnabled={false}
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.listBoardsPage).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      `${GENERATION_ID}.1`,
    );

    now += 44_000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(mocks.listBoardsPage).not.toHaveBeenCalled();

    mocks.listBoardsPage.mockResolvedValueOnce({
      boards: [board(2)],
      nextCursor: null,
    });
    now += 2_000;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.listBoardsPage).toHaveBeenCalledTimes(1);
    expect(mocks.listBoardsPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 16, workspaceId: WORKSPACE_ID }),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      `${GENERATION_ID}.2`,
    );
    expect(container.textContent).not.toContain("Latest revision");
    expect(container.textContent).not.toContain("Revision");

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(mocks.listBoardsPage).toHaveBeenCalledTimes(1);
  });

  it("adopts a new server-filtered bootstrap without fetching it again", async () => {
    const recentQueryKey = dashboardBoardQueryKey(WORKSPACE_ID, {
      q: "",
      view: "recent",
    });
    const favoriteQueryKey = dashboardBoardQueryKey(WORKSPACE_ID, {
      q: "",
      view: "favorite",
    });

    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          key={recentQueryKey}
          workspaceId={WORKSPACE_ID}
          view="recent"
          initialBoards={[board(1)]}
          initialBoardQueryKey={recentQueryKey}
          initialNextBoardCursor={null}
          organizationEnabled
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          key={favoriteQueryKey}
          workspaceId={WORKSPACE_ID}
          view="favorite"
          initialBoards={[{ ...board(2), favorite: true }]}
          initialBoardQueryKey={favoriteQueryKey}
          initialNextBoardCursor="next-favorites-page"
          organizationEnabled
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
      await Promise.resolve();
    });

    expect(mocks.listBoardsPage).not.toHaveBeenCalled();
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      `${GENERATION_ID}.2`,
    );
    expect(container.textContent).toContain("Load more boards");
  });

  it("starts with Grid and creates a board with the chosen theme", async () => {
    const initialBoardQueryKey = dashboardBoardQueryKey(WORKSPACE_ID, {
      q: "",
      view: "recent",
    });
    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          workspaceId={WORKSPACE_ID}
          initialBoards={[board(1)]}
          initialBoardQueryKey={initialBoardQueryKey}
          initialNextBoardCursor={null}
          organizationEnabled={false}
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
    });

    const openButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Create board");
    await act(async () => {
      openButton?.click();
    });

    const dialog = container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Create board"]',
    );
    expect(dialog).not.toBeNull();
    expect(
      dialog?.querySelector<HTMLInputElement>('input[value="grid"]')?.checked,
    ).toBe(true);

    await act(async () => {
      dialog?.querySelector<HTMLInputElement>('input[value="sage"]')?.click();
    });
    const createButton = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Create board");
    await act(async () => {
      createButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.createBoard).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      projectId: undefined,
      title: "Untitled board",
      theme: "sage",
    });
    expect(mocks.push).toHaveBeenCalledWith(
      `/app/boards/${board(1).id}`,
    );
  });

  it("lets only the board owner permanently delete after exact-title confirmation", async () => {
    const ownedBoard = board(1);
    const initialBoardQueryKey = dashboardBoardQueryKey(WORKSPACE_ID, {
      q: "",
      view: "recent",
    });
    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          workspaceId={WORKSPACE_ID}
          initialBoards={[ownedBoard]}
          initialBoardQueryKey={initialBoardQueryKey}
          initialNextBoardCursor={null}
          organizationEnabled={false}
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
      await Promise.resolve();
    });

    const openDeleteButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Delete Board");
    expect(openDeleteButton).not.toBeUndefined();
    act(() => openDeleteButton?.click());

    const dialog = container.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Delete board"]',
    );
    const confirmation = dialog?.querySelector<HTMLInputElement>(
      "#delete-board-confirmation",
    );
    const submitButton = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((button) => button.textContent?.trim() === "Delete board");
    expect(dialog?.textContent).toContain(ownedBoard.title);
    expect(submitButton?.disabled).toBe(true);

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(confirmation, `${ownedBoard.title} `);
      confirmation?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submitButton?.disabled).toBe(true);
    expect(mocks.deleteBoard).not.toHaveBeenCalled();

    act(() => {
      valueSetter?.call(confirmation, ownedBoard.title);
      confirmation?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submitButton?.disabled).toBe(false);

    await act(async () => {
      submitButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.deleteBoard).toHaveBeenCalledOnce();
    expect(mocks.deleteBoard).toHaveBeenCalledWith({
      boardId: ownedBoard.id,
      expectedTitle: ownedBoard.title,
      expectedDocumentGenerationId: ownedBoard.documentGenerationId,
    });
    expect(container.querySelector('[role="dialog"][aria-label="Delete board"]')).toBeNull();
    expect(container.textContent).not.toContain(ownedBoard.title);
    expect(container.textContent).toContain("Board deleted");
  });

  it("does not expose permanent deletion to a board editor", async () => {
    const editorBoard = { ...board(1), role: "editor" as const };
    const initialBoardQueryKey = dashboardBoardQueryKey(WORKSPACE_ID, {
      q: "",
      view: "recent",
    });
    await act(async () => {
      root.render(
        <WorkspaceDashboardPage
          workspaceId={WORKSPACE_ID}
          initialBoards={[editorBoard]}
          initialBoardQueryKey={initialBoardQueryKey}
          initialNextBoardCursor={null}
          organizationEnabled={false}
          initialProjects={[]}
          initialWorkspaces={[workspace]}
        />,
      );
      await Promise.resolve();
    });

    expect(
      [...container.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent?.trim() === "Delete Board",
      ),
    ).toBe(false);
    expect(container.querySelector('[role="dialog"][aria-label="Delete board"]')).toBeNull();
    expect(mocks.deleteBoard).not.toHaveBeenCalled();
  });
});
