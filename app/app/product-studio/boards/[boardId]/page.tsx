import type { Metadata } from "next";
import { EditorRoutePage } from "@/components/editor-route-page";
import { requireProtectedPagePrincipal } from "@/lib/auth/page-principal";
import { UuidSchema } from "@/lib/boards/contracts";
import { hasReadyPrivateMediaConfiguration } from "@/lib/health/deployment-readiness";
import { isBoardWorkspaceRolloutEnabled } from "@/lib/rollout/workspace-rollout";

export const metadata: Metadata = {
  title: "Board Editor",
  description: "Open and edit a saved Fabric canvas.",
};

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const { boardId } = await params;
  const principal = await requireProtectedPagePrincipal();
  const parsedBoardId = UuidSchema.safeParse(boardId);
  const organizationEnabled = parsedBoardId.success
    ? await isBoardWorkspaceRolloutEnabled(principal.id, parsedBoardId.data)
    : false;
  const privateMediaEnabled =
    organizationEnabled && hasReadyPrivateMediaConfiguration(process.env);
  return (
    <EditorRoutePage
      boardId={boardId}
      organizationEnabled={organizationEnabled}
      privateMediaEnabled={privateMediaEnabled}
    />
  );
}
