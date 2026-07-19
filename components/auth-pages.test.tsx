// @vitest-environment happy-dom

import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string | { pathname: string; query?: Record<string, string> };
    children: ReactNode;
  }) => (
    <a href={typeof href === "string" ? href : href.pathname} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    priority,
    fill,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    src: string;
    priority?: boolean;
    fill?: boolean;
  }) => {
    void priority;
    void fill;
    return <span role="img" aria-label={alt} data-src={src} {...props} />;
  },
}));

vi.mock("@/components/oauth-provider-buttons", () => ({
  OAuthProviderButtons: () => <div data-oauth-provider-buttons />,
}));

import { AuthPage } from "@/components/auth-pages";

function renderAuthPage(mode: "login" | "signup") {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<AuthPage mode={mode} returnTo="/app" />),
    "text/html",
  );
}

describe("AuthPage", () => {
  it("uses a full-width split without the old centered desktop gutter", () => {
    const document = renderAuthPage("login");
    const shell = document.querySelector<HTMLElement>("[data-auth-shell]");
    const visual = document.querySelector<HTMLElement>("[data-auth-visual]");
    const content = document.querySelector<HTMLElement>("[data-auth-content]");
    const image = visual?.querySelector<HTMLElement>('[role="img"]');

    expect(shell?.className).toContain("w-full");
    expect(shell?.className).toContain("lg:grid-cols-[minmax(26rem,5fr)_minmax(0,7fr)]");
    expect(shell?.className).not.toMatch(/\b(?:mx-auto|max-w-7xl)\b/);
    expect(image?.className).toContain("auth-visual-enter");
    expect(content?.className).toContain("auth-content-enter");
  });

  it("shares the animated layout across sign-in and account creation", () => {
    const login = renderAuthPage("login");
    const signup = renderAuthPage("signup");

    expect(login.querySelector("h1")?.textContent).toBe("Welcome back");
    expect(signup.querySelector("h1")?.textContent).toBe("Create your workspace");
    expect(login.querySelector("[data-auth-content]")?.className).toContain("auth-content-enter");
    expect(signup.querySelector("[data-auth-content]")?.className).toContain("auth-content-enter");
  });
});
