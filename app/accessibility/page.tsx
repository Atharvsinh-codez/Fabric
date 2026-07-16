import type { Metadata } from "next";
import { AccessibilityPage } from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Accessibility",
  description: "Review Fabric’s current semantic controls, shared-board list view, responsive behavior, and explicit canvas accessibility boundary.",
};

export default function Page() {
  return <AccessibilityPage />;
}
