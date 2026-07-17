import { PrivacyPage } from "@/components/marketing-pages";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "Privacy",
  description: "Understand Fabric’s current device, database, realtime, identity, and AI data boundaries.",
  path: "/privacy",
});

export default function Page() {
  return <PrivacyPage />;
}
