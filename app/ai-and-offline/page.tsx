import type { Metadata } from "next";
import { AiOfflinePage } from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "AI & Offline",
  description: "Learn how Fabric handles offline recovery and streamed AI proposals with explicit human approval.",
};

export default function Page() {
  return <AiOfflinePage />;
}
