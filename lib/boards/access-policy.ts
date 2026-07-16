import type {
  BoardAccessRole,
  BoardSharingPolicy,
  WorkspaceRole,
} from "@/db/schema/product";

export type BoardAccessSource =
  | "workspace_owner"
  | "board_owner"
  | "direct"
  | "project"
  | "workspace";

export type EffectiveBoardAccess = Readonly<{
  role: WorkspaceRole;
  source: BoardAccessSource;
  workspaceId: string;
  archivedAt: Date | null;
}>;

export type BoardAccessSnapshot = Readonly<{
  userId: string;
  workspaceId: string;
  ownerId: string;
  sharingPolicy: BoardSharingPolicy;
  archivedAt: Date | null;
  workspaceRole: WorkspaceRole | null;
  directRole: BoardAccessRole | null;
  projectRole: BoardAccessRole | null;
}>;

/**
 * Resolve the first applicable grant. This is intentionally precedence based,
 * not a most-permissive merge: a direct lower role overrides inherited access.
 */
export function effectiveBoardAccess(
  snapshot: BoardAccessSnapshot,
): EffectiveBoardAccess | null {
  if (snapshot.workspaceRole === "owner") {
    return {
      role: "owner",
      source: "workspace_owner",
      workspaceId: snapshot.workspaceId,
      archivedAt: snapshot.archivedAt,
    };
  }
  if (snapshot.ownerId === snapshot.userId) {
    return {
      role: "owner",
      source: "board_owner",
      workspaceId: snapshot.workspaceId,
      archivedAt: snapshot.archivedAt,
    };
  }
  if (snapshot.directRole) {
    return {
      role: snapshot.directRole,
      source: "direct",
      workspaceId: snapshot.workspaceId,
      archivedAt: snapshot.archivedAt,
    };
  }
  if (snapshot.sharingPolicy === "project" && snapshot.projectRole) {
    return {
      role: snapshot.projectRole,
      source: "project",
      workspaceId: snapshot.workspaceId,
      archivedAt: snapshot.archivedAt,
    };
  }
  if (snapshot.sharingPolicy === "workspace" && snapshot.workspaceRole) {
    return {
      role: snapshot.workspaceRole,
      source: "workspace",
      workspaceId: snapshot.workspaceId,
      archivedAt: snapshot.archivedAt,
    };
  }
  return null;
}
