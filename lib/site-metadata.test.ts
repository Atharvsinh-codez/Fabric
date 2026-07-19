import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import {
  GITHUB_REPOSITORY_URL,
  PUBLIC_SITE_PATHS,
  SITE_URL,
} from "@/lib/site";
import { createPublicPageMetadata } from "@/lib/site-metadata";

describe("public site metadata", () => {
  it("uses the final custom domain and repository", () => {
    expect(SITE_URL.href).toBe("https://fabric.athrix.me/");
    expect(GITHUB_REPOSITORY_URL).toBe(
      "https://github.com/Atharvsinh-codez/Fabric",
    );
  });

  it("publishes only canonical marketing routes in the sitemap", () => {
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual(
      PUBLIC_SITE_PATHS.map((path) => new URL(path, SITE_URL).href),
    );
    expect(entries.every((entry) => !entry.url.includes("/app/"))).toBe(true);
  });

  it("keeps private application surfaces out of crawler paths", () => {
    expect(robots()).toMatchObject({
      host: "https://fabric.athrix.me",
      sitemap: "https://fabric.athrix.me/sitemap.xml",
      rules: {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/app/", "/share/"],
      },
    });
  });

  it("provides installable and maskable Fabric icons", () => {
    const icons = manifest().icons ?? [];
    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
      ]),
    );
  });

  it("builds page-specific canonical and social metadata", () => {
    const metadata = createPublicPageMetadata({
      title: "Pricing",
      description: "Open-source Fabric access.",
      path: "/pricing",
    });

    expect(metadata.alternates?.canonical).toBe("/pricing");
    expect(metadata.openGraph).toMatchObject({
      url: "/pricing",
      title: "Pricing",
      description: "Open-source Fabric access.",
      images: [
        expect.objectContaining({
          url: "/images/fabric-og.png",
          width: 1901,
          height: 1077,
        }),
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: [expect.objectContaining({ url: "/images/fabric-og.png" })],
    });
  });
});
