import type { Metadata } from "next";

import { SharedBoardPage } from "@/components/shared-board-page";
import { resolvePublicBoardShare } from "@/lib/boards/public-share";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Shared Board",
  description: "View a read-only Fabric board shared with you.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = await resolvePublicBoardShare(token);
  return <SharedBoardPage share={share} />;
}
