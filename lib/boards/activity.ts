import "server-only";

import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { users } from "@/db/schema/auth";
import {
  boardComments,
  boardCommentThreads,
  boardMemberships,
  boards,
  projectMemberships,
  workspaceMemberships,
} from "@/db/schema/product";
import { resolveUserAvatar } from "@/lib/account/avatar-contracts";
import { userAvatarSelection } from "@/lib/account/avatar-db";
import { boardAccessSqlCondition } from "@/lib/boards/access-sql";
import type {
  WorkspaceActivityItem,
  WorkspaceActivityPage,
} from "@/lib/boards/activity-contracts";
import { requireWorkspaceCapability } from "@/lib/boards/authorization";
import { BoardApiError } from "@/lib/boards/http";
import {
  InvalidPaginationCursorError,
  decodeActivityCursor,
  encodeActivityCursor,
  paginationScope,
} from "@/lib/boards/pagination";

type ActivityCandidate = WorkspaceActivityItem &
  Readonly<{ occurredAtCursor: string }>;

export async function listWorkspaceActivity(input: {
  userId: string;
  workspaceId: string;
  cursor?: string;
  limit: number;
}): Promise<WorkspaceActivityPage> {
  const workspaceRole = await requireWorkspaceCapability(
    input.userId,
    input.workspaceId,
    "view",
  );
  const scope = paginationScope([
    "activity",
    input.userId,
    input.workspaceId,
  ]);
  let cursor;
  try {
    cursor = input.cursor
      ? decodeActivityCursor(input.cursor, scope)
      : undefined;
  } catch (error) {
    if (error instanceof InvalidPaginationCursorError) {
      throw new BoardApiError(
        400,
        "invalid_cursor",
        "The activity pagination cursor is invalid for this workspace.",
      );
    }
    throw error;
  }

  // C collation keeps database key ordering identical to the ASCII comparison
  // used when the three independently bounded sources are merged below.
  const boardEventId = sql<string>`('board:' || ${boards.id}::text) collate "C"`;
  const commentEventId = sql<string>`('comment:' || ${boardComments.id}::text) collate "C"`;
  const memberEventId = sql<string>`('member:' || ${workspaceMemberships.userId}::text) collate "C"`;
  const boardOccurredAtCursor = sql<string>`to_char(${boards.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const commentOccurredAtCursor = sql<string>`to_char(${boardComments.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const memberOccurredAtCursor = sql<string>`to_char(${workspaceMemberships.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const sourceLimit = input.limit + 1;

  const [boardRows, commentRows, memberRows] = await Promise.all([
    db
      .select({
        eventId: boardEventId,
        id: boards.id,
        title: boards.title,
        createdAt: boards.createdAt,
        updatedAt: boards.updatedAt,
        occurredAtCursor: boardOccurredAtCursor,
        actorName: users.name,
        actorAvatar: userAvatarSelection,
      })
      .from(boards)
      .innerJoin(users, eq(users.id, boards.createdBy))
      .leftJoin(
        boardMemberships,
        and(
          eq(boardMemberships.boardId, boards.id),
          eq(boardMemberships.workspaceId, boards.workspaceId),
          eq(boardMemberships.userId, input.userId),
        ),
      )
      .leftJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, boards.projectId),
          eq(projectMemberships.workspaceId, boards.workspaceId),
          eq(projectMemberships.userId, input.userId),
        ),
      )
      .where(
        and(
          eq(boards.workspaceId, input.workspaceId),
          boardAccessSqlCondition({ userId: input.userId, workspaceRole }),
          isNull(boards.archivedAt),
          cursor
            ? or(
                lt(
                  boards.updatedAt,
                  sql<Date>`${cursor.occurredAt}::timestamptz`,
                ),
                and(
                  eq(
                    boards.updatedAt,
                    sql<Date>`${cursor.occurredAt}::timestamptz`,
                  ),
                  lt(boardEventId, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(boards.updatedAt), desc(boardEventId))
      .limit(sourceLimit),
    db
      .select({
        eventId: commentEventId,
        id: boardComments.id,
        boardId: boards.id,
        boardTitle: boards.title,
        occurredAt: boardComments.createdAt,
        occurredAtCursor: commentOccurredAtCursor,
        actorName: users.name,
        actorAvatar: userAvatarSelection,
      })
      .from(boardComments)
      .innerJoin(
        boardCommentThreads,
        eq(boardCommentThreads.id, boardComments.threadId),
      )
      .innerJoin(boards, eq(boards.id, boardCommentThreads.boardId))
      .innerJoin(users, eq(users.id, boardComments.authorId))
      .leftJoin(
        boardMemberships,
        and(
          eq(boardMemberships.boardId, boards.id),
          eq(boardMemberships.workspaceId, boards.workspaceId),
          eq(boardMemberships.userId, input.userId),
        ),
      )
      .leftJoin(
        projectMemberships,
        and(
          eq(projectMemberships.projectId, boards.projectId),
          eq(projectMemberships.workspaceId, boards.workspaceId),
          eq(projectMemberships.userId, input.userId),
        ),
      )
      .where(
        and(
          eq(boards.workspaceId, input.workspaceId),
          boardAccessSqlCondition({ userId: input.userId, workspaceRole }),
          isNull(boards.archivedAt),
          isNull(boardComments.deletedAt),
          cursor
            ? or(
                lt(
                  boardComments.createdAt,
                  sql<Date>`${cursor.occurredAt}::timestamptz`,
                ),
                and(
                  eq(
                    boardComments.createdAt,
                    sql<Date>`${cursor.occurredAt}::timestamptz`,
                  ),
                  lt(commentEventId, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(boardComments.createdAt), desc(commentEventId))
      .limit(sourceLimit),
    db
      .select({
        eventId: memberEventId,
        userId: workspaceMemberships.userId,
        role: workspaceMemberships.role,
        occurredAt: workspaceMemberships.createdAt,
        occurredAtCursor: memberOccurredAtCursor,
        actorName: users.name,
        actorAvatar: userAvatarSelection,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .where(
        and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          cursor
            ? or(
                lt(
                  workspaceMemberships.createdAt,
                  sql<Date>`${cursor.occurredAt}::timestamptz`,
                ),
                and(
                  eq(
                    workspaceMemberships.createdAt,
                    sql<Date>`${cursor.occurredAt}::timestamptz`,
                  ),
                  lt(memberEventId, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(workspaceMemberships.createdAt), desc(memberEventId))
      .limit(sourceLimit),
  ]);

  const candidates: ActivityCandidate[] = [
    ...boardRows.map((row): ActivityCandidate => {
      const isCreation = row.createdAt.getTime() === row.updatedAt.getTime();
      return {
        id: row.eventId,
        type: "Boards",
        actorName: isCreation ? row.actorName : null,
        actorImage: isCreation
          ? resolveUserAvatar(row.actorAvatar).image
          : null,
        action: isCreation ? "created" : "Board content changed in",
        target: row.title,
        targetHref: `/app/product-studio/boards/${row.id}`,
        occurredAt: row.updatedAt.toISOString(),
        occurredAtCursor: row.occurredAtCursor,
      };
    }),
    ...commentRows.map((row): ActivityCandidate => ({
      id: row.eventId,
      type: "Comments",
      actorName: row.actorName,
      actorImage: resolveUserAvatar(row.actorAvatar).image,
      action: "commented in",
      target: row.boardTitle,
      targetHref: `/app/product-studio/boards/${row.boardId}`,
      occurredAt: row.occurredAt.toISOString(),
      occurredAtCursor: row.occurredAtCursor,
    })),
    ...memberRows.map((row): ActivityCandidate => ({
      id: row.eventId,
      type: "Members",
      actorName: row.actorName,
      actorImage: resolveUserAvatar(row.actorAvatar).image,
      action: `joined as ${row.role} in`,
      target: "Member access",
      targetHref: `/app/product-studio/members?workspaceId=${encodeURIComponent(input.workspaceId)}`,
      occurredAt: row.occurredAt.toISOString(),
      occurredAtCursor: row.occurredAtCursor,
    })),
  ];

  candidates.sort((left, right) => {
    if (left.occurredAtCursor !== right.occurredAtCursor) {
      return left.occurredAtCursor > right.occurredAtCursor ? -1 : 1;
    }
    if (left.id === right.id) return 0;
    return left.id > right.id ? -1 : 1;
  });

  const visible = candidates.slice(0, input.limit);
  const lastItem = visible.at(-1);
  return {
    items: visible.map((item) => ({
      id: item.id,
      type: item.type,
      actorName: item.actorName,
      actorImage: item.actorImage,
      action: item.action,
      target: item.target,
      targetHref: item.targetHref,
      occurredAt: item.occurredAt,
    })),
    nextCursor:
      candidates.length > input.limit && lastItem
        ? encodeActivityCursor(
            { occurredAt: lastItem.occurredAtCursor, id: lastItem.id },
            scope,
          )
        : null,
  };
}
