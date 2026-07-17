import type { Metadata } from "next";

import { SettingsPage } from "@/components/workspace-pages";

export const metadata: Metadata = {
  title: "Workspace Settings",
  description: "Review collaboration and AI policy for your active Fabric workspace.",
};

export default async function DashboardSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const { workspaceId } = await searchParams;
  return <SettingsPage workspaceId={typeof workspaceId === "string" ? workspaceId : undefined} />;
}
