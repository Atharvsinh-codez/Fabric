import type { Metadata } from "next";

import { WorkspacesPage } from "@/components/workspaces-page";
import { requireProtectedPagePrincipal } from "@/lib/auth/page-principal";
import type { WorkspaceSummary } from "@/lib/boards/client";
import { loadWorkspaceBootstrap } from "@/lib/boards/dashboard-loader";

export const metadata: Metadata = {
  title: "Workspaces",
  description: "Choose a Fabric workspace or create a new one.",
};

export default async function AppIndexPage() {
  const principal = await requireProtectedPagePrincipal();
  let initialLoadError = false;
  let initialWorkspaces: WorkspaceSummary[] = [];

  try {
    initialWorkspaces = await loadWorkspaceBootstrap(principal.id);
  } catch {
    initialLoadError = true;
  }

  return (
    <WorkspacesPage
      initialWorkspaces={initialWorkspaces}
      initialLoadError={initialLoadError}
    />
  );
}
