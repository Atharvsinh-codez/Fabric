import {
  GITHUB_REPOSITORY_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

const structuredData = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL.href,
  description: SITE_DESCRIPTION,
  applicationCategory: "DesignApplication",
  operatingSystem: "Web",
  browserRequirements: "Requires a modern web browser with JavaScript enabled.",
  isAccessibleForFree: true,
  sameAs: [GITHUB_REPOSITORY_URL],
  codeRepository: GITHUB_REPOSITORY_URL,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export function SiteStructuredData() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
      }}
    />
  );
}
