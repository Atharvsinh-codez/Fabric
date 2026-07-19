// @vitest-environment happy-dom

import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspaceClient = vi.hoisted(() => ({
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
  push: vi.fn(),
  shellProps: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: workspaceClient.push }),
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

vi.mock("@/components/workspace-shell", () => ({
  WorkspaceShell: ({
    action,
    availableWorkspaces,
    children,
  }: {
    action?: ReactNode;
    availableWorkspaces?: readonly unknown[];
    children: ReactNode;
  }) => {
    workspaceClient.shellProps({ availableWorkspaces });
    return (
      <main>
        {action}
        {children}
      </main>
    );
  },
}));

vi.mock("@/lib/boards/client", () => ({
  createWorkspace: workspaceClient.createWorkspace,
  listWorkspaces: workspaceClient.listWorkspaces,
}));

import { WorkspacesPage } from "./workspaces-page";

const existingWorkspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Product Studio",
  role: "owner" as const,
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-07-16T10:00:00.000Z",
};

const createdWorkspace = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Research Lab",
  role: "owner" as const,
  createdAt: "2026-07-17T10:00:00.000Z",
  updatedAt: "2026-07-17T10:00:00.000Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("all workspaces control center", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    workspaceClient.createWorkspace.mockReset();
    workspaceClient.listWorkspaces.mockReset();
    workspaceClient.push.mockReset();
    workspaceClient.shellProps.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderPage(initialWorkspaces = [existingWorkspace]) {
    act(() => {
      root.render(<WorkspacesPage initialWorkspaces={initialWorkspaces} />);
    });
  }

  function openDialog() {
    const trigger = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "New Workspace",
    );
    act(() => trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  }

  function enterWorkspaceName(name: string) {
    const input = container.querySelector<HTMLInputElement>("#new-workspace-name");
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(input, name);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("exposes canonical workspace and account destinations", () => {
    renderPage();

    expect(workspaceClient.shellProps).toHaveBeenLastCalledWith({
      availableWorkspaces: [existingWorkspace],
    });

    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")].map(
      (link) => [link.textContent?.trim(), link.getAttribute("href")],
    );
    expect(links).toContainEqual([
      "Open Dashboard",
      `/app/dashboard?workspaceId=${existingWorkspace.id}`,
    ]);
    expect(links).toContainEqual([
      "Members",
      `/app/dashboard/members?workspaceId=${existingWorkspace.id}`,
    ]);
    expect(links).toContainEqual([
      "Settings",
      `/app/dashboard/settings?workspaceId=${existingWorkspace.id}`,
    ]);
    expect(links).toContainEqual(["Open Account Settings", "/app/account"]);
    expect(container.innerHTML).not.toContain("product-studio");
    expect(container.textContent).not.toContain("Durable PostgreSQL persistence");
  });

  it("creates one workspace for repeated submits and opens its dashboard", async () => {
    const creation = deferred<typeof createdWorkspace>();
    workspaceClient.createWorkspace.mockReturnValue(creation.promise);
    renderPage();
    openDialog();
    enterWorkspaceName("  Research Lab  ");

    const form = container.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(workspaceClient.createWorkspace).toHaveBeenCalledOnce();
    expect(workspaceClient.createWorkspace).toHaveBeenCalledWith("Research Lab");
    expect(container.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Creating...",
      )?.disabled,
    ).toBe(true);

    await act(async () => {
      creation.resolve(createdWorkspace);
      await creation.promise;
      await Promise.resolve();
    });

    expect(workspaceClient.push).toHaveBeenCalledWith(
      `/app/dashboard?workspaceId=${createdWorkspace.id}`,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain("Research Lab");
    expect(workspaceClient.shellProps).toHaveBeenLastCalledWith({
      availableWorkspaces: [createdWorkspace, existingWorkspace],
    });
  });

  it("keeps the dialog open with a useful retryable error", async () => {
    workspaceClient.createWorkspace.mockRejectedValue(
      new Error("Workspace creation is temporarily unavailable. Try again."),
    );
    renderPage([]);
    openDialog();
    enterWorkspaceName("Research Lab");

    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Workspace creation is temporarily unavailable. Try again.",
    );
    expect(
      [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Create Workspace",
      )?.disabled,
    ).toBe(false);
    expect(workspaceClient.push).not.toHaveBeenCalled();
  });
});
