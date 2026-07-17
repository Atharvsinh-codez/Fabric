import type { Metadata } from "next";

import { ActivityPage } from "@/components/workspace-pages";

export const metadata: Metadata = {
  title: "Activity",
  description: "Review workspace changes, comments, and accepted proposals.",
};

export default async function DashboardActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const { workspaceId } = await searchParams;
  return <ActivityPage workspaceId={typeof workspaceId === "string" ? workspaceId : undefined} />;
}
