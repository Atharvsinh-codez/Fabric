import type { Metadata } from "next";
import { LandingMain } from "@/components/landing/landing-main";

export const metadata: Metadata = {
  title: { absolute: "Fabric — Think spatially. Decide with context." },
  description:
    "A local-first multiplayer canvas where product teams turn research, notes, screenshots, and diagrams into decisions.",
};

export default function Home() {
  return <LandingMain />;
}
