import type { Metadata } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

type PublicPageMetadata = {
  title: string;
  description?: string;
  path: `/${string}` | "/";
  absoluteTitle?: boolean;
};

const SOCIAL_IMAGE = {
  url: "/images/fabric-og.png",
  width: 1901,
  height: 1077,
  alt: "Fabric turns scattered thinking into shared direction",
} as const;

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
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: SOCIAL_IMAGE.url, alt: SOCIAL_IMAGE.alt }],
    },
  };
}
