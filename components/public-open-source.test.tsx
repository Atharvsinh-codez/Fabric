// @vitest-environment happy-dom

import type { AnchorHTMLAttributes, ImgHTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    priority: _priority,
    fill: _fill,
    ...props
  }: ImgHTMLAttributes<HTMLImageElement> & {
    src: string;
    priority?: boolean;
    fill?: boolean;
  }) => <img src={src} alt={alt} {...props} />,
}));

import { LandingHeader } from "@/components/landing/site-header";
import { PricingPage } from "@/components/marketing-pages";
import { MarketingHeader } from "@/components/marketing-shell";
import { GITHUB_REPOSITORY_URL } from "@/lib/site";

function repositoryLinks(markup: string) {
  const document = new DOMParser().parseFromString(markup, "text/html");
  return [...document.querySelectorAll<HTMLAnchorElement>(`a[href="${GITHUB_REPOSITORY_URL}"]`)];
}

describe("public open-source presentation", () => {
  it.each([
    ["landing", <LandingHeader />],
    ["marketing", <MarketingHeader />],
  ])("links the %s header to the public repository", (_name, header) => {
    const links = repositoryLinks(renderToStaticMarkup(header));
    expect(links.length).toBeGreaterThanOrEqual(2);
    expect(links.every((link) => link.target === "_blank")).toBe(true);
    expect(links.every((link) => link.rel === "noreferrer")).toBe(true);
  });

  it("explains that Fabric is open source on the pricing page", () => {
    const markup = renderToStaticMarkup(<PricingPage />);
    expect(markup).toContain("Open source");
    expect(markup).toContain("Open-source project");
    expect(repositoryLinks(markup).length).toBeGreaterThanOrEqual(3);
  });
});
