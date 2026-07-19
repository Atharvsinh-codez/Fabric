import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirectAuthenticatedPagePrincipal: vi.fn(),
}));

vi.mock("@/lib/auth/page-principal", () => ({
  redirectAuthenticatedPagePrincipal: mocks.redirectAuthenticatedPagePrincipal,
}));

vi.mock("@/components/auth-pages", () => ({
  AuthPage: ({ mode, returnTo }: { mode: string; returnTo: string }) => (
    <div data-auth-mode={mode} data-return-to={returnTo} />
  ),
}));

import LoginPage from "./login/page";
import SignupPage from "./signup/page";

function getRenderedAuthProps(markup: string): {
  mode: string | null;
  returnTo: string | null;
} {
  const mode = markup.match(/data-auth-mode="([^"]+)"/)?.[1] ?? null;
  const returnTo = markup.match(/data-return-to="([^"]+)"/)?.[1] ?? null;
  return { mode, returnTo };
}

describe("public auth page routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirectAuthenticatedPagePrincipal.mockResolvedValue(undefined);
  });

  it("checks the session before rendering login and preserves a safe return path", async () => {
    const view = await LoginPage({
      searchParams: Promise.resolve({ returnTo: "/app/account?tab=profile" }),
    });

    expect(mocks.redirectAuthenticatedPagePrincipal).toHaveBeenCalledOnce();
    expect(getRenderedAuthProps(renderToStaticMarkup(view))).toEqual({
      mode: "login",
      returnTo: "/app/account?tab=profile",
    });
  });

  it("checks the session before rendering signup and keeps its safe anonymous fallback", async () => {
    const view = await SignupPage({
      searchParams: Promise.resolve({ returnTo: "https://attacker.example/app" }),
    });

    expect(mocks.redirectAuthenticatedPagePrincipal).toHaveBeenCalledOnce();
    expect(getRenderedAuthProps(renderToStaticMarkup(view))).toEqual({
      mode: "signup",
      returnTo: "/app/onboarding",
    });
  });
});
