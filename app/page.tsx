import { LandingMain } from "@/components/landing/landing-main";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "Fabric — Think spatially. Decide with context.",
  description:
    "A local-first multiplayer canvas where product teams turn research, notes, screenshots, and diagrams into decisions.",
  path: "/",
  absoluteTitle: true,
});

export default function Home() {
  return <LandingMain />;
}
