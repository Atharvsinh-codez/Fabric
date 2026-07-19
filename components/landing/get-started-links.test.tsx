// @vitest-environment happy-dom

import type {
  AnchorHTMLAttributes,
  ImgHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
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
    priority,
    fill,
  }: ImgHTMLAttributes<HTMLImageElement> & {
    src: string;
    priority?: boolean;
    fill?: boolean;
  }) => {
    void priority;
    void fill;
    return <span role="img" aria-label={alt} data-src={src} />;
  },
}));

import { LandingHero } from "@/components/landing/hero";
import { StartWorkingSection } from "@/components/landing/image-story-sections";
import { LandingFooter } from "@/components/landing/site-footer";
import { LandingHeader } from "@/components/landing/site-header";

function getStartedDestinations(element: ReactElement): string[] {
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(element),
    "text/html",
  );

  return [...document.querySelectorAll<HTMLAnchorElement>("a")]
    .filter((link) => link.textContent?.trim() === "Get started")
    .map((link) => link.getAttribute("href") ?? "");
}

describe("landing page Get started links", () => {
  it.each([
    ["header", <LandingHeader key="header" />],
    ["hero", <LandingHero key="hero" />],
    ["start-working section", <StartWorkingSection key="start-working" />],
    ["footer", <LandingFooter key="footer" />],
  ])("routes the %s call to action through the protected app entry", (_name, element) => {
    expect(getStartedDestinations(element)).toEqual(["/app"]);
  });
});
