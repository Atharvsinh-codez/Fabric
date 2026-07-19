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

describe("landing hero", () => {
  it("fills the viewport and vertically balances its content", () => {
    const document = new DOMParser().parseFromString(
      renderToStaticMarkup(<LandingHero />),
      "text/html",
    );
    const hero = document.querySelector<HTMLElement>("[data-landing-hero]");
    const content = hero?.querySelector<HTMLElement>(":scope > div");

    expect(hero?.className).toContain("min-h-svh");
    expect(hero?.className).not.toMatch(/min-h-\[(?:43|47)rem\]/);
    expect(content?.className).toContain("justify-center");
    expect(content?.className).toContain("pt-28");
    expect(content?.className).toContain("lg:pt-36");
  });
});
