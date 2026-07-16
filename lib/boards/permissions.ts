import type { WorkspaceRole } from "../../db/schema/product";

export type WorkspaceCapability =
  | "view"
  | "create_board"
  | "edit_board"
  | "comment"
  | "resolve_comment"
  | "manage_members"
  | "manage_sharing";

const CAPABILITIES: Record<WorkspaceRole, ReadonlySet<WorkspaceCapability>> = {
  owner: new Set([
    "view",
    "create_board",
    "edit_board",
    "comment",
    "resolve_comment",
    "manage_members",
    "manage_sharing",
  ]),
  editor: new Set(["view", "create_board", "edit_board", "comment", "resolve_comment"]),
  commenter: new Set(["view", "comment"]),
  viewer: new Set(["view"]),
};

export function roleCan(role: WorkspaceRole, capability: WorkspaceCapability): boolean {
  return CAPABILITIES[role].has(capability);
}
