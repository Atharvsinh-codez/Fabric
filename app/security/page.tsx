import { SecurityPage } from "@/components/marketing-pages";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "Security",
  description: "Review Fabric’s security boundaries, implemented controls, operational gates, and external assurance status.",
  path: "/security",
});

export default function Page() {
  return <SecurityPage />;
}
