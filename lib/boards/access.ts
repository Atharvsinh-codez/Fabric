import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db/clients/web";
import {
  boardMemberships,
  boards,
  projectMemberships,
  workspaceMemberships,
  workspaces,
} from "@/db/schema/product";
import {
  effectiveBoardAccess,
  type EffectiveBoardAccess,
} from "@/lib/boards/access-policy";

export {
  effectiveBoardAccess,
  type BoardAccessSnapshot,
  type BoardAccessSource,
  type EffectiveBoardAccess,
} from "@/lib/boards/access-policy";

export async function resolveBoardAccess(
  userId: string,
  boardId: string,
): Promise<EffectiveBoardAccess | null> {
  const [snapshot] = await db
    .select({
      workspaceId: boards.workspaceId,
      ownerId: boards.ownerId,
      sharingPolicy: boards.sharingPolicy,
      archivedAt: boards.archivedAt,
      workspaceRole: workspaceMemberships.role,
      directRole: boardMemberships.role,
      projectRole: projectMemberships.role,
    })
    .from(boards)
    .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
    .leftJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, boards.workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    )
    .leftJoin(
      boardMemberships,
      and(
        eq(boardMemberships.boardId, boards.id),
        eq(boardMemberships.workspaceId, boards.workspaceId),
        eq(boardMemberships.userId, userId),
      ),
    )
    .leftJoin(
      projectMemberships,
      and(
        eq(projectMemberships.projectId, boards.projectId),
        eq(projectMemberships.workspaceId, boards.workspaceId),
        eq(projectMemberships.userId, userId),
      ),
    )
    .where(
      and(
        eq(boards.id, boardId),
        isNull(boards.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);

  return snapshot
    ? effectiveBoardAccess({ userId, ...snapshot })
    : null;
}
