import type { Metadata } from "next";
import { PricingPage } from "@/components/marketing-pages";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Fabric currently requires no subscription or payment details. Review the included capabilities and deployment boundaries.",
};

export default function Page() {
  return <PricingPage />;
}
