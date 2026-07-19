// @vitest-environment happy-dom

import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  deleteWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  router: {
    replace: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/dashboard/settings",
  useRouter: () => settings.router,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
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
  }) =>
    open ? (
      <section role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {children}
      </section>
    ) : null,
}));

vi.mock("@/components/current-user-provider", () => ({
  getUserInitials: () => "AJ",
  useCurrentUser: () => ({
    email: "atharv@example.com",
    id: "11111111-1111-4111-8111-111111111111",
    image: null,
    name: "Atharv",
  }),
}));

vi.mock("@/app/actions/account", () => ({
  updateCurrentProfile: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  signOutCurrentSession: vi.fn(),
}));

vi.mock("@/lib/boards/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boards/client")>();
  return {
    ...actual,
    deleteWorkspace: settings.deleteWorkspace,
    listWorkspaces: settings.listWorkspaces,
  };
});

import type { WorkspaceSummary } from "@/lib/boards/client";
import { SettingsPage } from "./workspace-pages";

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_NAME = "Research Lab";

function workspace(role: WorkspaceSummary["role"]): WorkspaceSummary {
  return {
    id: WORKSPACE_ID,
    name: WORKSPACE_NAME,
    role,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:00:00.000Z",
  };
}

function findButton(container: ParentNode, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

function enterText(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("SettingsPage workspace deletion", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not expose workspace deletion to non-owners", async () => {
    settings.listWorkspaces.mockResolvedValue([workspace("editor")]);

    await act(async () => {
      root.render(<SettingsPage workspaceId={WORKSPACE_ID} />);
      await settle();
    });

    expect(container.textContent).not.toContain("Danger Zone");
    expect(findButton(container, "Delete workspace")).toBeUndefined();
  });

  it("requires the exact workspace name, deletes it, and returns to all workspaces", async () => {
    settings.listWorkspaces.mockResolvedValue([workspace("owner")]);
    settings.deleteWorkspace.mockResolvedValue({
      id: WORKSPACE_ID,
      deletedAt: "2026-07-19T11:00:00.000Z",
    });

    await act(async () => {
      root.render(<SettingsPage workspaceId={WORKSPACE_ID} />);
      await settle();
    });

    expect(container.textContent).toContain("Danger Zone");

    act(() => findButton(container, "Delete workspace")?.click());

    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    const confirmationInput = dialog?.querySelector<HTMLInputElement>(
      "#delete-workspace-confirmation",
    );
    const submitButton = dialog
      ? findButton(dialog, "Delete workspace")
      : undefined;

    expect(dialog?.getAttribute("aria-label")).toBe("Delete workspace");
    expect(confirmationInput).toBeTruthy();
    expect(submitButton?.disabled).toBe(true);

    act(() => enterText(confirmationInput!, "research lab"));
    expect(submitButton?.disabled).toBe(true);
    expect(settings.deleteWorkspace).not.toHaveBeenCalled();

    act(() => enterText(confirmationInput!, WORKSPACE_NAME));
    expect(submitButton?.disabled).toBe(false);

    await act(async () => {
      submitButton?.click();
      await settle();
    });

    expect(settings.deleteWorkspace).toHaveBeenCalledOnce();
    expect(settings.deleteWorkspace).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      expectedName: WORKSPACE_NAME,
    });
    expect(settings.router.replace).toHaveBeenCalledWith("/app");
  });
});
