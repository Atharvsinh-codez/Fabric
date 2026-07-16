import "server-only";

import { and, eq, isNotNull, or, type SQL } from "drizzle-orm";

import {
  boardMemberships,
  boards,
  projectMemberships,
  type WorkspaceRole,
} from "@/db/schema/product";

/**
 * SQL equivalent of the effective-access grant predicates. Callers must join
 * the direct and project membership tables for the requested user first.
 */
export function boardAccessSqlCondition(input: {
  userId: string;
  workspaceRole: WorkspaceRole;
}): SQL | undefined {
  if (input.workspaceRole === "owner") return undefined;
  return or(
    eq(boards.ownerId, input.userId),
    isNotNull(boardMemberships.userId),
    and(
      eq(boards.sharingPolicy, "project"),
      isNotNull(projectMemberships.userId),
    ),
    eq(boards.sharingPolicy, "workspace"),
  );
}
