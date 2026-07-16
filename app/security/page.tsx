import type { Metadata } from "next";
import { SecurityPage } from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Security",
  description: "Review Fabric’s security boundaries, implemented controls, operational gates, and external assurance status.",
};

export default function Page() {
  return <SecurityPage />;
}
