import type { WorkspaceCapability } from "@/lib/boards/permissions";

export type BoardCheckpointAction = "list" | "create" | "restore";

const CHECKPOINT_CAPABILITIES: Record<BoardCheckpointAction, WorkspaceCapability> = {
  list: "view",
  create: "edit_board",
  restore: "edit_board",
};

export function checkpointCapability(action: BoardCheckpointAction): WorkspaceCapability {
  return CHECKPOINT_CAPABILITIES[action];
}
