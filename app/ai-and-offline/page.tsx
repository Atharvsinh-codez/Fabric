import { AiOfflinePage } from "@/components/marketing-pages";
import { createPublicPageMetadata } from "@/lib/site-metadata";

export const metadata = createPublicPageMetadata({
  title: "AI & Offline",
  description: "Learn how Fabric handles offline recovery and streamed AI proposals with explicit human approval.",
  path: "/ai-and-offline",
});

export default function Page() {
  return <AiOfflinePage />;
}
