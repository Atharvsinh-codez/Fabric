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
    tooltipAlign: _tooltipAlign,
    tooltipSide: _tooltipSide,
    ...props
  }: {
    label: string;
    children: ReactNode;
    onClick?: () => void;
    tooltipAlign?: string;
    tooltipSide?: string;
  }) => {
    void _tooltipAlign;
    void _tooltipSide;
    return (
      <button type="button" aria-label={label} {...props}>
        {children}
      </button>
    );
  },
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

const availableWorkspaces = [
  {
    id: recentBoard.workspaceId,
    name: "Product Studio",
    role: "owner" as const,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-17T10:00:00.000Z",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Research Lab",
    role: "editor" as const,
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
  },
];

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
    window.localStorage.clear();
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

  it("lists every accessible workspace in global navigation", () => {
    act(() => {
      root.render(
        <WorkspaceShell
          availableWorkspaces={availableWorkspaces}
          title="All Workspaces"
          description="Manage workspaces."
        >
          <p>Workspace list</p>
        </WorkspaceShell>,
      );
    });

    const desktopSidebar = container.querySelector("#workspace-desktop-sidebar");
    expect(desktopSidebar?.textContent).toContain("Product Studio");
    expect(desktopSidebar?.textContent).toContain("Research Lab");
    expect(
      desktopSidebar?.querySelector(
        `a[href="/app/dashboard?workspaceId=${availableWorkspaces[0]?.id}"]`,
      ),
    ).not.toBeNull();
    expect(
      desktopSidebar?.querySelector(
        `a[href="/app/dashboard?workspaceId=${availableWorkspaces[1]?.id}"]`,
      ),
    ).not.toBeNull();
  });

  it("collapses and expands the shared desktop sidebar accessibly", () => {
    act(() => {
      root.render(
        <WorkspaceShell
          availableWorkspaces={availableWorkspaces}
          title="All Workspaces"
          description="Manage workspaces."
        >
          <p>Workspace list</p>
        </WorkspaceShell>,
      );
    });

    const desktopSidebar = container.querySelector("#workspace-desktop-sidebar");
    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse workspace sidebar"]',
    );
    expect(collapseButton?.getAttribute("aria-expanded")).toBe("true");
    expect(desktopSidebar?.parentElement?.getAttribute("data-state")).toBe("expanded");

    act(() => collapseButton?.click());

    const expandButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand workspace sidebar"]',
    );
    expect(expandButton?.getAttribute("aria-expanded")).toBe("false");
    expect(desktopSidebar?.parentElement?.getAttribute("data-state")).toBe("collapsed");
    expect(window.localStorage.getItem("fabric:workspace-sidebar-collapsed:v1")).toBe(
      "true",
    );

    act(() => expandButton?.click());
    expect(
      container.querySelector('button[aria-label="Collapse workspace sidebar"]'),
    ).not.toBeNull();
    expect(desktopSidebar?.parentElement?.getAttribute("data-state")).toBe("expanded");
  });

  it("makes shell navigation inert while an external modal is open", () => {
    const renderShell = (modalOpen: boolean) => {
      act(() => {
        root.render(
          <WorkspaceShell
            availableWorkspaces={availableWorkspaces}
            title="All Workspaces"
            description="Manage workspaces."
            modalOpen={modalOpen}
          >
            <p>Workspace list</p>
          </WorkspaceShell>,
        );
      });
    };

    renderShell(true);

    const shell = container.querySelector<HTMLElement>("[data-workspace-shell]");
    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Collapse workspace sidebar"]',
    );
    expect(shell?.getAttribute("data-modal-open")).toBe("");
    expect(shell?.getAttribute("aria-hidden")).toBe("true");
    expect(shell?.hasAttribute("inert")).toBe(true);
    expect(collapseButton?.disabled).toBe(true);

    act(() => {
      collapseButton?.click();
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      container.querySelector('button[aria-label="Expand workspace sidebar"]'),
    ).toBeNull();
    expect(container.querySelector("#workspace-quick-navigation-title")).toBeNull();
    expect(window.localStorage.getItem("fabric:workspace-sidebar-collapsed:v1")).toBeNull();

    renderShell(false);
    expect(shell?.hasAttribute("data-modal-open")).toBe(false);
    expect(shell?.hasAttribute("aria-hidden")).toBe(false);
    expect(shell?.hasAttribute("inert")).toBe(false);
    expect(collapseButton?.disabled).toBe(false);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(container.querySelector("#workspace-quick-navigation-title")).not.toBeNull();
  });

  it("opens and closes the animated mobile navigation disclosure", () => {
    act(() => {
      root.render(
        <WorkspaceShell
          availableWorkspaces={availableWorkspaces}
          title="All Workspaces"
          description="Manage workspaces."
        >
          <p>Workspace list</p>
        </WorkspaceShell>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open workspace navigation"]',
    );
    const drawer = container.querySelector("#workspace-mobile-sidebar");
    const overlay = drawer?.parentElement;
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(overlay?.getAttribute("data-state")).toBe("closed");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");

    act(() => trigger?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(overlay?.getAttribute("data-state")).toBe("open");
    expect(overlay?.getAttribute("aria-hidden")).toBe("false");

    const closeButton = drawer?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close navigation"]',
    );
    act(() => closeButton?.click());
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(overlay?.getAttribute("data-state")).toBe("closed");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
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
