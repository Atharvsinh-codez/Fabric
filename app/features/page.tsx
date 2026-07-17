import { FeaturesPage } from "@/components/marketing-pages";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "Features",
  description: "Explore Fabric’s local-first multiplayer canvas, structured list view, collaboration model, and reviewable AI workflow.",
  path: "/features",
});

export default function Page() {
  return <FeaturesPage />;
}
