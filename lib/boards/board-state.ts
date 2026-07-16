import type {
  BoardStatus,
  BoardWorkflowStatus,
  WorkspaceRole,
} from "@/db/schema/product";
import type { BoardDetail } from "@/lib/boards/client";
import type { RealtimeCapability } from "@/lib/realtime/constants";

type BoardInteractionState = Readonly<{
  role: WorkspaceRole;
  archivedAt: Date | string | null;
}>;

export function canEditBoardState(board: BoardInteractionState): boolean {
  return (
    board.archivedAt === null &&
    (board.role === "owner" || board.role === "editor")
  );
}

export function canCommentOnBoardState(board: BoardInteractionState): boolean {
  return board.archivedAt === null && board.role !== "viewer";
}

export type BoardSessionAccess = Readonly<{
  canEdit: boolean;
  canComment: boolean;
  canManageSharing: boolean;
  shouldRefreshAccess: boolean;
}>;

/**
 * Combines the exact HTTP role with the latest realtime authorization without
 * treating a transient disconnect as a downgrade. A resolved read-only ticket
 * immediately closes writable/admin UI, while comments continue to use the
 * exact board role because realtime read access cannot distinguish commenters
 * from viewers.
 */
export function resolveBoardSessionAccess(input: BoardInteractionState & Readonly<{
  realtimeCapabilities: readonly RealtimeCapability[];
  realtimeWriteEnabled: boolean;
  realtimeAccessLost: boolean;
  accessLost: boolean;
}>): BoardSessionAccess {
  const roleCanEdit = canEditBoardState(input);
  const resolvedReadOnly =
    input.realtimeCapabilities.length > 0 &&
    !input.realtimeCapabilities.includes("write");
  const accessLost = input.accessLost || input.realtimeAccessLost;
  const authorizationContradictsWritableRole = roleCanEdit && resolvedReadOnly;

  return {
    canEdit:
      roleCanEdit &&
      input.realtimeWriteEnabled &&
      !accessLost &&
      !resolvedReadOnly,
    canComment: !accessLost && canCommentOnBoardState(input),
    canManageSharing:
      !accessLost &&
      !authorizationContradictsWritableRole &&
      input.archivedAt === null &&
      input.role === "owner",
    shouldRefreshAccess:
      input.realtimeAccessLost || authorizationContradictsWritableRole,
  };
}

/**
 * Refreshes role and organization metadata without replacing the mounted
 * canvas recovery base. The caller keeps the local document, optimistic HTTP
 * revision, document generation, and realtime IndexedDB/outbox lifecycle.
 */
export function mergeBoardMetadataPreservingLocalDocument(
  current: BoardDetail,
  remote: BoardDetail,
): BoardDetail {
  return {
    ...remote,
    document: current.document,
    revision: current.revision,
    documentGenerationId: current.documentGenerationId,
  };
}

export function deriveBoardStatus(
  storedStatus: BoardWorkflowStatus,
  archivedAt: Date | string | null,
): BoardStatus {
  return archivedAt === null ? storedStatus : "archived";
}
