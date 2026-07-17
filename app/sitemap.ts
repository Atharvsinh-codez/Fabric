import type { MetadataRoute } from "next";

import { PUBLIC_SITE_PATHS, SITE_URL } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_SITE_PATHS.map((path) => ({
    url: new URL(path, SITE_URL).href,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : path === "/features" || path === "/pricing" ? 0.8 : 0.6,
  }));
}
