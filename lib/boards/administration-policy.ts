import type { WorkspaceRole } from "@/db/schema/product";
import type { WorkspaceCapability } from "@/lib/boards/permissions";

type BoardAdministrationSnapshot = Readonly<{
  actorId: string;
  boardOwnerId: string;
  actorWorkspaceRole: WorkspaceRole | null;
}>;

export function canAdministerBoard(snapshot: BoardAdministrationSnapshot): boolean {
  return snapshot.actorWorkspaceRole === "owner" || snapshot.actorId === snapshot.boardOwnerId;
}

export function canAdministerProject(actorWorkspaceRole: WorkspaceRole | null): boolean {
  return actorWorkspaceRole === "owner";
}

export function canTransferBoardOwnership(
  snapshot: BoardAdministrationSnapshot &
    Readonly<{
      targetWorkspaceRole: WorkspaceRole | null;
    }>,
): boolean {
  return snapshot.targetWorkspaceRole !== null && canAdministerBoard(snapshot);
}

export function requiredBoardMetadataCapability(input: Readonly<{
  ownerId?: string;
  projectId?: string;
  sharingPolicy?: string;
}>): Extract<WorkspaceCapability, "edit_board" | "manage_sharing"> {
  return input.ownerId !== undefined ||
    input.projectId !== undefined ||
    input.sharingPolicy !== undefined
    ? "manage_sharing"
    : "edit_board";
}
