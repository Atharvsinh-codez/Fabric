import { PricingPage } from "@/components/marketing-pages";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "Pricing",
  description: "Fabric is an open-source multiplayer canvas with no subscription or payment details required. Explore the product and its public source code.",
  path: "/pricing",
});

export default function Page() {
  return <PricingPage />;
}
