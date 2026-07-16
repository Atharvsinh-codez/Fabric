import type { Metadata } from "next";

import { ActivityPage } from "@/components/workspace-pages";

export const metadata: Metadata = {
  title: "Activity",
  description: "Review workspace changes, comments, and accepted proposals.",
};

export default async function ProductStudioActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const { workspaceId } = await searchParams;
  return <ActivityPage workspaceId={typeof workspaceId === "string" ? workspaceId : undefined} />;
}
