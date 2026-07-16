import type { Metadata } from "next";
import { FeaturesPage } from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Features",
  description: "Explore Fabric’s local-first multiplayer canvas, structured list view, collaboration model, and reviewable AI workflow.",
};

export default function Page() {
  return <FeaturesPage />;
}
