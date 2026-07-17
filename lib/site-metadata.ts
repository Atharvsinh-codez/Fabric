import type { Metadata } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

type PublicPageMetadata = {
  title: string;
  description?: string;
  path: `/${string}` | "/";
  absoluteTitle?: boolean;
};

export function createPublicPageMetadata({
  title,
  description = SITE_DESCRIPTION,
  path,
  absoluteTitle = false,
}: PublicPageMetadata): Metadata {
  const resolvedTitle = absoluteTitle ? { absolute: title } : title;

  return {
    title: resolvedTitle,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: path,
      siteName: SITE_NAME,
      title,
      description,
      images: [
        {
          url: "/opengraph-image",
          width: 1200,
          height: 630,
          alt: "Fabric — open-source multiplayer canvas",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/twitter-image"],
    },
  };
}
