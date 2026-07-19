// @vitest-environment happy-dom

import { act, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onboarding = vi.hoisted(() => ({
  replace: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/onboarding",
  useRouter: () => ({ replace: onboarding.replace }),
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

vi.mock("@/components/current-user-provider", () => ({
  getUserInitials: () => "AJ",
  useCurrentUser: () => ({
    email: "atharv@example.com",
    id: "11111111-1111-4111-8111-111111111111",
    image: null,
    name: "Atharv",
  }),
}));

vi.mock("@/lib/onboarding/client", () => ({
  submitOnboarding: onboarding.submit,
}));

vi.mock("@/app/actions/account", () => ({
  updateCurrentProfile: vi.fn(),
}));

vi.mock("@/app/actions/auth", () => ({
  signOutCurrentSession: vi.fn(),
}));

import { OnboardingPage } from "./workspace-pages";

const createdWorkspaceId = "22222222-2222-4222-8222-222222222222";

function findButton(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === label,
  );
}

describe("workspace onboarding", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onboarding.replace.mockReset();
    onboarding.submit.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("opens the newly created workspace after onboarding completes", async () => {
    onboarding.submit.mockResolvedValue({
      workspace: { id: createdWorkspaceId, name: "Atharv's workspace", role: "owner" },
      board: {
        id: "33333333-3333-4333-8333-333333333333",
        workspaceId: createdWorkspaceId,
        title: "Product planning board",
        revision: 0,
        documentGenerationId: "44444444-4444-4444-8444-444444444444",
        role: "owner",
      },
    });

    act(() => root.render(<OnboardingPage />));

    act(() => findButton(container, "Continue")?.click());
    act(() => findButton(container, "Continue")?.click());

    await act(async () => {
      findButton(container, "Create Workspace")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const workspacePath = `/app/dashboard?workspaceId=${createdWorkspaceId}`;
    expect(onboarding.submit).toHaveBeenCalledOnce();
    expect(onboarding.replace).toHaveBeenCalledWith(workspacePath);
    expect(
      container.querySelector<HTMLAnchorElement>('a[href^="/app/dashboard"]')?.href,
    ).toContain(workspacePath);
    expect(container.textContent).toContain("Open Workspace");
  });
});
