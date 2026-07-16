import type { Metadata } from "next";

import { OnboardingPage } from "@/components/workspace-pages";

export const metadata: Metadata = {
  title: "Set Up Workspace",
  description: "Set up a Fabric workspace and starter board.",
};

export default function AppOnboardingPage() {
  return <OnboardingPage />;
}
