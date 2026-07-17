// @vitest-environment happy-dom

import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/app",
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.searchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/current-user-provider", () => ({
  useCurrentUser: () => ({
    id: "user:test",
    name: "Atharv",
    email: "atharv@example.com",
    image: null,
  }),
}));

vi.mock("@/components/ui", () => ({
  cx: (...classes: Array<string | false | null | undefined>) =>
    classes.filter(Boolean).join(" "),
  FabricLogo: () => <div>Fabric</div>,
  IconButton: ({
    label,
    children,
    ...props
  }: {
    label: string;
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" aria-label={label} {...props}>
      {children}
    </button>
  ),
  UserAvatar: () => <div>User Avatar</div>,
}));

vi.mock("@/lib/boards/client", () => ({
  listBoards: vi.fn(async () => []),
}));

import { WorkspaceShell } from "./workspace-shell";

const recentBoard = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  projectName: "Unfiled",
  ownerId: "user:test",
  title: "Planning Board",
  cover: null,
  status: "active" as const,
  sharingPolicy: "workspace" as const,
  revision: 3,
  documentGenerationId: "33333333-3333-4333-8333-333333333333",
  role: "owner" as const,
  favorite: false,
  pinned: false,
  lastOpenedAt: null,
  archivedAt: null,
  createdAt: "2026-07-16T10:00:00.000Z",
  updatedAt: "2026-07-17T10:00:00.000Z",
};

describe("workspace shell navigation modes", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    navigation.pathname = "/app";
    navigation.searchParams = new URLSearchParams();
    navigation.push.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps global mode free of workspace-specific navigation", () => {
    act(() => {
      root.render(
        <WorkspaceShell title="All Workspaces" description="Manage workspaces.">
          <p>Workspace list</p>
        </WorkspaceShell>,
      );
    });

    const desktopSidebar = container.querySelector("aside");
    expect(desktopSidebar?.textContent).toContain("All Workspaces");
    expect(desktopSidebar?.textContent).not.toContain("Recent boards");
    expect(desktopSidebar?.textContent).not.toMatch(/Boards|Members|Activity|Settings/);
    expect(desktopSidebar?.querySelector('a[href="/app/account"]')).not.toBeNull();
  });

  it("scopes active navigation and recent boards to canonical routes", () => {
    navigation.pathname = "/app/dashboard";
    const workspaceId = recentBoard.workspaceId;
    act(() => {
      root.render(
        <WorkspaceShell
          title="Boards"
          description="Open workspace boards."
          workspaceId={workspaceId}
          workspaceName="Product Studio"
          recentBoards={[recentBoard]}
        >
          <p>Board list</p>
        </WorkspaceShell>,
      );
    });

    const hrefs = [...container.querySelectorAll<HTMLAnchorElement>("a")].map(
      (link) => link.getAttribute("href"),
    );
    expect(hrefs).toContain(`/app/dashboard?workspaceId=${workspaceId}`);
    expect(hrefs).toContain(`/app/dashboard/members?workspaceId=${workspaceId}`);
    expect(hrefs).toContain(`/app/dashboard/activity?workspaceId=${workspaceId}`);
    expect(hrefs).toContain(`/app/dashboard/settings?workspaceId=${workspaceId}`);
    expect(hrefs).toContain(`/app/boards/${recentBoard.id}`);
    expect(hrefs.some((href) => href?.includes("product-studio"))).toBe(false);
  });
});
