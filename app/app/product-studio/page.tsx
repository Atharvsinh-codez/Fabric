import type { Metadata } from "next";

import { WorkspaceDashboardPage } from "@/components/workspace-dashboard-page";
import { requireProtectedPagePrincipal } from "@/lib/auth/page-principal";
import {
  loadDashboardBootstrap,
  type DashboardBootstrap,
} from "@/lib/boards/dashboard-loader";

export const metadata: Metadata = {
  title: "Boards",
  description: "Open and manage boards in your active Fabric workspace.",
};

export default async function ProductStudioPage({
  searchParams,
}: {
  searchParams: Promise<{
    workspaceId?: string | string[];
    q?: string | string[];
    view?: string | string[];
    projectId?: string | string[];
    status?: string | string[];
  }>;
}) {
  const { workspaceId, q, view, projectId, status } = await searchParams;
  const selectedWorkspaceId = typeof workspaceId === "string" ? workspaceId : undefined;
  const principal = await requireProtectedPagePrincipal();
  let initialLoadError = false;
  let bootstrap: DashboardBootstrap = {
    boards: [],
    organizationEnabled: false,
    projects: [],
    workspaces: [],
  };

  try {
    bootstrap = await loadDashboardBootstrap(principal.id, selectedWorkspaceId);
  } catch {
    initialLoadError = true;
  }

  return (
    <WorkspaceDashboardPage
      workspaceId={selectedWorkspaceId}
      query={typeof q === "string" ? q : undefined}
      view={typeof view === "string" ? view : undefined}
      projectId={typeof projectId === "string" ? projectId : undefined}
      status={typeof status === "string" ? status : undefined}
      initialBoards={bootstrap.boards}
      organizationEnabled={bootstrap.organizationEnabled}
      initialProjects={bootstrap.projects}
      initialWorkspaces={bootstrap.workspaces}
      initialLoadError={initialLoadError}
    />
  );
}
