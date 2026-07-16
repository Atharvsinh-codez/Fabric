import type { Metadata } from "next";
import { PrivacyPage } from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Privacy",
  description: "Understand Fabric’s current device, database, realtime, identity, and AI data boundaries.",
};

export default function Page() {
  return <PrivacyPage />;
}
