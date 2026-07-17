import { AccessibilityPage } from "@/components/marketing-pages";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "Accessibility",
  description: "Review Fabric’s current semantic controls, shared-board list view, responsive behavior, and explicit canvas accessibility boundary.",
  path: "/accessibility",
});

export default function Page() {
  return <AccessibilityPage />;
}
