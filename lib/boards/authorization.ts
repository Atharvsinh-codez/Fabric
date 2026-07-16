import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { workspaceMemberships, type WorkspaceRole } from "@/db/schema/product";
import { resolveBoardAccess } from "@/lib/boards/access";
import { BoardApiError } from "@/lib/boards/http";
import { roleCan, type WorkspaceCapability } from "@/lib/boards/permissions";

export async function requireWorkspaceCapability(
  userId: string,
  workspaceId: string,
  capability: WorkspaceCapability,
): Promise<WorkspaceRole> {
  const [membership] = await db
    .select({ role: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    )
    .limit(1);

  if (!membership || !roleCan(membership.role, capability)) {
    throw new BoardApiError(404, "not_found", "The requested resource was not found.");
  }
  return membership.role;
}

export async function requireBoardCapability(
  userId: string,
  boardId: string,
  capability: WorkspaceCapability,
): Promise<{ role: WorkspaceRole; workspaceId: string }> {
  const access = await resolveBoardAccess(userId, boardId);

  if (!access || !roleCan(access.role, capability)) {
    throw new BoardApiError(404, "not_found", "The requested resource was not found.");
  }
  if (access.archivedAt && capability !== "view") {
    throw new BoardApiError(409, "board_archived", "Restore this board before changing it.");
  }
  return { role: access.role, workspaceId: access.workspaceId };
}
