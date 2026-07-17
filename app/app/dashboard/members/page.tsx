import type { Metadata } from "next";

import { MembersPage } from "@/components/workspace-pages";
import { requireProtectedPagePrincipal } from "@/lib/auth/page-principal";
import { loadWorkspaceBootstrap } from "@/lib/boards/dashboard-loader";
import { isWorkspaceRolloutEnabled } from "@/lib/rollout/workspace-rollout";

export const metadata: Metadata = {
  title: "Members",
  description: "Manage access to your active Fabric workspace.",
};

export default async function DashboardMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ workspaceId?: string | string[] }>;
}) {
  const { workspaceId } = await searchParams;
  const requestedWorkspaceId =
    typeof workspaceId === "string" ? workspaceId : undefined;
  const principal = await requireProtectedPagePrincipal();
  const workspaces = await loadWorkspaceBootstrap(principal.id);
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === requestedWorkspaceId) ??
    workspaces[0] ??
    null;
  const organizationWorkspaceId =
    activeWorkspace && isWorkspaceRolloutEnabled(activeWorkspace.id)
      ? activeWorkspace.id
      : null;

  return (
    <MembersPage
      workspaceId={requestedWorkspaceId}
      organizationWorkspaceId={organizationWorkspaceId}
    />
  );
}
