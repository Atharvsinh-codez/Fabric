import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/clients/web";
import { boardAssets } from "@/db/schema/assets";
import { accounts, users } from "@/db/schema/auth";
import { realtimeRevocationOutbox } from "@/db/schema/collaboration";
import {
  boardComments,
  boardCommentThreads,
  boardMemberships,
  boards,
  boardShareLinks,
  boardUserPreferences,
  projectMemberships,
  projects,
  workspaceAuditEvents,
  workspaceMemberships,
  workspaces,
  type BoardCoverMetadata,
  type BoardDocument,
  type BoardSharingPolicy,
  type BoardStatus,
  type CommentAnchor,
  type ShareLinkPermission,
  type WorkspaceRole,
} from "@/db/schema/product";
import { resolveUserAvatar } from "@/lib/account/avatar-contracts";
import { userAvatarSelection } from "@/lib/account/avatar-db";
import { effectiveBoardAccess, resolveBoardAccess } from "@/lib/boards/access";
import { boardAccessSqlCondition } from "@/lib/boards/access-sql";
import {
  canTransferBoardOwnership,
  requiredBoardMetadataCapability,
} from "@/lib/boards/administration-policy";
import { boardOwnershipTransferredAuditEvent } from "@/lib/boards/audit-events";
import { SUPPORTED_BOARD_IMAGE_MIME_TYPES } from "@/lib/boards/assets/contracts";
import { deriveBoardStatus } from "@/lib/boards/board-state";
import {
  requireBoardCapability,
  requireWorkspaceCapability,
} from "@/lib/boards/authorization";
import { BoardApiError } from "@/lib/boards/http";
import {
  InvalidPaginationCursorError,
  decodeBoardListCursor,
  encodeBoardListCursor,
  paginationScope,
} from "@/lib/boards/pagination";
import {
  BOARD_LIST_DEFAULT_PAGE_SIZE,
  BOARD_LIST_MAX_PAGE_SIZE,
} from "@/lib/boards/pagination-contract";
import {
  boardAccessReconfiguredRevocation,
  boardArchivedRevocation,
  boardOwnerChangedRevocation,
  workspaceMemberRemovedRevocation,
  workspaceMemberRoleChangedRevocation,
} from "@/lib/realtime/revocation-events";

const defaultDocument: BoardDocument = { version: 1, nodes: [], edges: [] };

export async function createWorkspace(userId: string, name: string) {
  return db.transaction(async (transaction) => {
    const [workspace] = await transaction
      .insert(workspaces)
      .values({ name, createdBy: userId })
      .returning();
    if (!workspace) throw new Error("Workspace insert returned no row.");

    await transaction.insert(workspaceMemberships).values({
      workspaceId: workspace.id,
      userId,
      role: "owner",
    });
    const [defaultProject] = await transaction
      .insert(projects)
      .values({
        workspaceId: workspace.id,
        name: "Unfiled",
        icon: "folder",
        defaultSharingPolicy: "workspace",
        isDefault: true,
        createdBy: userId,
      })
      .returning({ id: projects.id });
    if (!defaultProject) throw new Error("Default project insert returned no row.");
    await transaction.insert(projectMemberships).values({
      workspaceId: workspace.id,
      projectId: defaultProject.id,
      userId,
      role: "editor",
    });
    return { ...workspace, role: "owner" as const };
  });
}

export async function listWorkspaces(userId: string) {
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMemberships.role,
      createdAt: workspaces.createdAt,
      updatedAt: workspaces.updatedAt,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .where(eq(workspaceMemberships.userId, userId))
    .orderBy(desc(workspaces.updatedAt));
}

export async function createBoard(input: {
  userId: string;
  workspaceId: string;
  projectId?: string;
  title: string;
  sharingPolicy?: BoardSharingPolicy;
  cover?: Extract<BoardCoverMetadata, { kind: "preset" }> | null;
  document?: BoardDocument;
}) {
  await requireWorkspaceCapability(input.userId, input.workspaceId, "create_board");
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      defaultSharingPolicy: projects.defaultSharingPolicy,
    })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, input.workspaceId),
        input.projectId ? eq(projects.id, input.projectId) : eq(projects.isDefault, true),
      ),
    )
    .limit(1);
  if (!project) {
    throw new BoardApiError(404, "not_found", "The requested project was not found.");
  }
  const [board] = await db
    .insert(boards)
    .values({
      workspaceId: input.workspaceId,
      projectId: project.id,
      ownerId: input.userId,
      title: input.title,
      sharingPolicy: input.sharingPolicy ?? project.defaultSharingPolicy,
      cover: input.cover ?? null,
      document: input.document ?? defaultDocument,
      createdBy: input.userId,
    })
    .returning();
  if (!board) throw new Error("Board insert returned no row.");
  return {
    ...board,
    projectName: project.name,
    favorite: false,
    pinned: false,
    lastOpenedAt: null,
    role: "owner" as const,
  };
}

export type BoardListInput = Readonly<{
  userId: string;
  workspaceId: string;
  view?: "recent" | "favorite" | "pinned" | "shared" | "archived" | "all";
  q?: string;
  projectId?: string;
  status?: BoardStatus;
  cursor?: string;
  limit?: number;
}>;

function boardSearchCondition(query: string) {
  if (!query) return undefined;
  const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
  return sql`${boards.title} ilike ${`%${escaped}%`} escape ${"\\"}`;
}

export async function listBoardsPage(input: BoardListInput) {
  const workspaceRole = await requireWorkspaceCapability(
    input.userId,
    input.workspaceId,
    "view",
  );
  const view = input.view ?? "recent";
  const archived = view === "archived" || input.status === "archived";
  const normalizedQuery = input.q?.trim() ?? "";
  const limit = Math.min(
    Math.max(input.limit ?? BOARD_LIST_DEFAULT_PAGE_SIZE, 1),
    BOARD_LIST_MAX_PAGE_SIZE,
  );
  const scope = paginationScope([
    "boards",
    input.userId,
    input.workspaceId,
    view,
    normalizedQuery,
    input.projectId ?? null,
    input.status ?? null,
  ]);
  let cursor;
  try {
    cursor = input.cursor
      ? decodeBoardListCursor(input.cursor, scope)
      : undefined;
  } catch (error) {
    if (error instanceof InvalidPaginationCursorError) {
      throw new BoardApiError(
        400,
        "invalid_cursor",
        "The board pagination cursor is invalid for this query.",
      );
    }
    throw error;
  }
  const pinnedRank = sql<number>`case when ${boardUserPreferences.pinnedAt} is not null then 1 else 0 end`;
  const sortAt =
    view === "recent"
      ? sql<Date>`coalesce(${boardUserPreferences.lastOpenedAt}, ${boards.updatedAt})`.mapWith(
          boards.updatedAt,
        )
      : sql<Date>`${boards.updatedAt}`.mapWith(boards.updatedAt);
  const sortAtCursor = sql<string>`to_char((${sortAt}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  const cursorSortAt = cursor
    ? sql<Date>`${cursor.sortAt}::timestamptz`
    : undefined;
  const cursorCondition = cursor
    ? or(
        lt(pinnedRank, cursor.pinned ? 1 : 0),
        and(
          eq(pinnedRank, cursor.pinned ? 1 : 0),
          lt(sortAt, cursorSortAt),
        ),
        and(
          eq(pinnedRank, cursor.pinned ? 1 : 0),
          eq(sortAt, cursorSortAt),
          lt(boards.id, cursor.id),
        ),
      )
    : undefined;
  const rows = await db
    .select({
      id: boards.id,
      workspaceId: boards.workspaceId,
      projectId: boards.projectId,
      projectName: projects.name,
      ownerId: boards.ownerId,
      title: boards.title,
      cover: boards.cover,
      status: boards.status,
      sharingPolicy: boards.sharingPolicy,
      revision: boards.revision,
      documentGenerationId: boards.documentGenerationId,
      archivedAt: boards.archivedAt,
      createdAt: boards.createdAt,
      updatedAt: boards.updatedAt,
      directRole: boardMemberships.role,
      projectRole: projectMemberships.role,
      favoritedAt: boardUserPreferences.favoritedAt,
      pinnedAt: boardUserPreferences.pinnedAt,
      lastOpenedAt: boardUserPreferences.lastOpenedAt,
      sortAtCursor,
    })
    .from(boards)
    .innerJoin(
      projects,
      and(
        eq(projects.id, boards.projectId),
        eq(projects.workspaceId, boards.workspaceId),
      ),
    )
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
    .leftJoin(
      boardUserPreferences,
      and(
        eq(boardUserPreferences.boardId, boards.id),
        eq(boardUserPreferences.workspaceId, boards.workspaceId),
        eq(boardUserPreferences.userId, input.userId),
      ),
    )
    .where(
      and(
        eq(boards.workspaceId, input.workspaceId),
        archived ? isNotNull(boards.archivedAt) : isNull(boards.archivedAt),
        input.projectId ? eq(boards.projectId, input.projectId) : undefined,
        input.status && input.status !== "archived"
          ? eq(boards.status, input.status)
          : undefined,
        boardAccessSqlCondition({ userId: input.userId, workspaceRole }),
        boardSearchCondition(normalizedQuery),
        view === "favorite"
          ? isNotNull(boardUserPreferences.favoritedAt)
          : undefined,
        view === "pinned"
          ? isNotNull(boardUserPreferences.pinnedAt)
          : undefined,
        view === "shared" ? ne(boards.ownerId, input.userId) : undefined,
        cursorCondition,
      ),
    )
    .orderBy(desc(pinnedRank), desc(sortAt), desc(boards.id))
    .limit(limit + 1);

  const visibleRows = rows.slice(0, limit);
  const listedBoards = visibleRows.map((row) => {
    const access = effectiveBoardAccess({
      userId: input.userId,
      workspaceId: row.workspaceId,
      ownerId: row.ownerId,
      sharingPolicy: row.sharingPolicy,
      archivedAt: row.archivedAt,
      workspaceRole,
      directRole: row.directRole,
      projectRole: row.projectRole,
    });
    if (!access) {
      throw new Error("SQL board access scope diverged from access resolution.");
    }
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      projectName: row.projectName,
      ownerId: row.ownerId,
      title: row.title,
      cover: row.cover,
      status: deriveBoardStatus(row.status, row.archivedAt),
      sharingPolicy: row.sharingPolicy,
      revision: row.revision,
      documentGenerationId: row.documentGenerationId,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      favorite: Boolean(row.favoritedAt),
      pinned: Boolean(row.pinnedAt),
      lastOpenedAt: row.lastOpenedAt,
      role: access.role,
    };
  });
  const lastRow = visibleRows.at(-1);
  return {
    boards: listedBoards,
    nextCursor:
      rows.length > limit && lastRow
        ? encodeBoardListCursor(
            {
              pinned: Boolean(lastRow.pinnedAt),
              sortAt: lastRow.sortAtCursor,
              id: lastRow.id,
            },
            scope,
          )
        : null,
  } as const;
}

/** First-page compatibility for server-rendered recent-board surfaces. */
export async function listBoards(
  input: Omit<BoardListInput, "cursor" | "limit">,
) {
  return (await listBoardsPage(input)).boards;
}

export async function getBoard(userId: string, boardId: string) {
  const { role, workspaceId } = await requireBoardCapability(userId, boardId, "view");
  const [board] = await db
    .select({
      board: boards,
      projectName: projects.name,
      favoritedAt: boardUserPreferences.favoritedAt,
      pinnedAt: boardUserPreferences.pinnedAt,
    })
    .from(boards)
    .innerJoin(
      projects,
      and(eq(projects.id, boards.projectId), eq(projects.workspaceId, boards.workspaceId)),
    )
    .leftJoin(
      boardUserPreferences,
      and(
        eq(boardUserPreferences.boardId, boards.id),
        eq(boardUserPreferences.workspaceId, boards.workspaceId),
        eq(boardUserPreferences.userId, userId),
      ),
    )
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)))
    .limit(1);
  if (!board) throw new BoardApiError(404, "not_found", "The requested board was not found.");
  const now = new Date();
  await db
    .insert(boardUserPreferences)
    .values({ workspaceId, boardId, userId, lastOpenedAt: now })
    .onConflictDoUpdate({
      target: [boardUserPreferences.boardId, boardUserPreferences.userId],
      set: { lastOpenedAt: now, updatedAt: now },
    });
  return {
    ...board.board,
    status: deriveBoardStatus(board.board.status, board.board.archivedAt),
    projectName: board.projectName,
    favorite: Boolean(board.favoritedAt),
    pinned: Boolean(board.pinnedAt),
    lastOpenedAt: now,
    role,
  };
}

export async function updateBoardMetadata(input: {
  userId: string;
  boardId: string;
  title?: string;
  projectId?: string;
  ownerId?: string;
  status?: Exclude<BoardStatus, "archived">;
  sharingPolicy?: BoardSharingPolicy;
  cover?: BoardCoverMetadata | null;
}) {
  const capability = requiredBoardMetadataCapability(input);
  const { workspaceId } = await requireBoardCapability(
    input.userId,
    input.boardId,
    capability,
  );
  return db.transaction(async (transaction) => {
    const lockedMembers =
      input.ownerId === undefined
        ? []
        : await transaction
            .select({
              userId: workspaceMemberships.userId,
              role: workspaceMemberships.role,
            })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceId, workspaceId),
                inArray(
                  workspaceMemberships.userId,
                  Array.from(new Set([input.userId, input.ownerId])).sort(),
                ),
              ),
            )
            .orderBy(asc(workspaceMemberships.userId))
            .for("update");

    const [lockedBoard] = await transaction
      .select({
        ownerId: boards.ownerId,
        projectId: boards.projectId,
        sharingPolicy: boards.sharingPolicy,
        documentGenerationId: boards.documentGenerationId,
        archivedAt: boards.archivedAt,
      })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), eq(boards.workspaceId, workspaceId)))
      .limit(1)
      .for("update");
    if (!lockedBoard) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }
    if (lockedBoard.archivedAt) {
      throw new BoardApiError(409, "board_archived", "Restore this board before changing it.");
    }

    if (input.projectId) {
      const [project] = await transaction
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, workspaceId)))
        .limit(1)
        .for("update");
      if (!project) {
        throw new BoardApiError(404, "not_found", "The requested project was not found.");
      }
    }

    if (input.cover?.kind === "asset") {
      const [coverAsset] = await transaction
        .select({ id: boardAssets.id })
        .from(boardAssets)
        .where(
          and(
            eq(boardAssets.id, input.cover.assetId),
            eq(boardAssets.boardId, input.boardId),
            inArray(boardAssets.mimeType, [...SUPPORTED_BOARD_IMAGE_MIME_TYPES]),
            inArray(boardAssets.storageState, ["postgres_only", "r2_ready"]),
          ),
        )
        .limit(1)
        .for("share");
      if (!coverAsset) {
        throw new BoardApiError(404, "not_found", "The requested cover asset was not found.");
      }
    }

    if (input.ownerId !== undefined) {
      const actorRole =
        lockedMembers.find((member) => member.userId === input.userId)?.role ?? null;
      const targetRole =
        lockedMembers.find((member) => member.userId === input.ownerId)?.role ?? null;
      if (
        !canTransferBoardOwnership({
          actorId: input.userId,
          boardOwnerId: lockedBoard.ownerId,
          actorWorkspaceRole: actorRole,
          targetWorkspaceRole: targetRole,
        })
      ) {
        throw new BoardApiError(404, "not_found", "The requested owner was not found.");
      }
    }

    const [board] = await transaction
      .update(boards)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sharingPolicy !== undefined ? { sharingPolicy: input.sharingPolicy } : {}),
        ...(input.cover !== undefined ? { cover: input.cover } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(boards.id, input.boardId), eq(boards.workspaceId, workspaceId)))
      .returning({
        id: boards.id,
        workspaceId: boards.workspaceId,
        projectId: boards.projectId,
        ownerId: boards.ownerId,
        title: boards.title,
        cover: boards.cover,
        status: boards.status,
        sharingPolicy: boards.sharingPolicy,
        revision: boards.revision,
        documentGenerationId: boards.documentGenerationId,
        archivedAt: boards.archivedAt,
        createdAt: boards.createdAt,
        updatedAt: boards.updatedAt,
      });
    if (!board) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }

    if (input.ownerId !== undefined && input.ownerId !== lockedBoard.ownerId) {
      await transaction.insert(workspaceAuditEvents).values(
        boardOwnershipTransferredAuditEvent({
          workspaceId,
          actorId: input.userId,
          targetId: input.boardId,
          previousOwnerId: lockedBoard.ownerId,
          nextOwnerId: input.ownerId,
        }),
      );
      await transaction.insert(realtimeRevocationOutbox).values(
        boardOwnerChangedRevocation({
          workspaceId,
          boardId: input.boardId,
          documentGenerationId: lockedBoard.documentGenerationId,
          previousOwnerId: lockedBoard.ownerId,
        }),
      );
    }
    if (
      (input.projectId !== undefined && input.projectId !== lockedBoard.projectId) ||
      (input.sharingPolicy !== undefined &&
        input.sharingPolicy !== lockedBoard.sharingPolicy)
    ) {
      await transaction.insert(realtimeRevocationOutbox).values(
        boardAccessReconfiguredRevocation({
          workspaceId,
          boardId: input.boardId,
          documentGenerationId: lockedBoard.documentGenerationId,
        }),
      );
    }
    const [projection] = await transaction
      .select({
        projectName: projects.name,
        workspaceRole: workspaceMemberships.role,
        directRole: boardMemberships.role,
        projectRole: projectMemberships.role,
        favoritedAt: boardUserPreferences.favoritedAt,
        pinnedAt: boardUserPreferences.pinnedAt,
        lastOpenedAt: boardUserPreferences.lastOpenedAt,
      })
      .from(boards)
      .innerJoin(
        projects,
        and(
          eq(projects.id, boards.projectId),
          eq(projects.workspaceId, boards.workspaceId),
        ),
      )
      .leftJoin(
        workspaceMemberships,
        and(
          eq(workspaceMemberships.workspaceId, boards.workspaceId),
          eq(workspaceMemberships.userId, input.userId),
        ),
      )
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
      .leftJoin(
        boardUserPreferences,
        and(
          eq(boardUserPreferences.boardId, boards.id),
          eq(boardUserPreferences.workspaceId, boards.workspaceId),
          eq(boardUserPreferences.userId, input.userId),
        ),
      )
      .where(
        and(
          eq(boards.id, input.boardId),
          eq(boards.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!projection) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }
    const updatedAccess = effectiveBoardAccess({
      userId: input.userId,
      workspaceId,
      ownerId: board.ownerId,
      sharingPolicy: board.sharingPolicy,
      archivedAt: board.archivedAt,
      workspaceRole: projection.workspaceRole,
      directRole: projection.directRole,
      projectRole: projection.projectRole,
    });
    return {
      ...board,
      projectName: projection.projectName,
      status: deriveBoardStatus(board.status, board.archivedAt),
      favorite: Boolean(projection.favoritedAt),
      pinned: Boolean(projection.pinnedAt),
      lastOpenedAt: projection.lastOpenedAt,
      // A private-board owner can intentionally transfer away their final
      // grant. Return a conservative role until the client refreshes access.
      role: updatedAccess?.role ?? ("viewer" as const),
    };
  });
}

export async function archiveBoard(input: { userId: string; boardId: string }) {
  const { role, workspaceId } = await requireBoardCapability(
    input.userId,
    input.boardId,
    "edit_board",
  );
  return db.transaction(async (transaction) => {
    const now = new Date();
    const [board] = await transaction
      .update(boards)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(boards.id, input.boardId),
          eq(boards.workspaceId, workspaceId),
          isNull(boards.archivedAt),
        ),
      )
      .returning();
    if (!board) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }
    await transaction.insert(realtimeRevocationOutbox).values(
      boardArchivedRevocation({
        workspaceId,
        boardId: input.boardId,
        documentGenerationId: board.documentGenerationId,
      }),
    );
    const [projection] = await transaction
      .select({
        projectName: projects.name,
        favoritedAt: boardUserPreferences.favoritedAt,
        pinnedAt: boardUserPreferences.pinnedAt,
        lastOpenedAt: boardUserPreferences.lastOpenedAt,
      })
      .from(boards)
      .innerJoin(
        projects,
        and(
          eq(projects.id, boards.projectId),
          eq(projects.workspaceId, boards.workspaceId),
        ),
      )
      .leftJoin(
        boardUserPreferences,
        and(
          eq(boardUserPreferences.boardId, boards.id),
          eq(boardUserPreferences.workspaceId, boards.workspaceId),
          eq(boardUserPreferences.userId, input.userId),
        ),
      )
      .where(
        and(
          eq(boards.id, input.boardId),
          eq(boards.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!projection) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }
    return {
      ...board,
      projectName: projection.projectName,
      status: deriveBoardStatus(board.status, board.archivedAt),
      favorite: Boolean(projection.favoritedAt),
      pinned: Boolean(projection.pinnedAt),
      lastOpenedAt: projection.lastOpenedAt,
      role,
    };
  });
}

export async function restoreBoard(input: { userId: string; boardId: string }) {
  const access = await resolveBoardAccess(input.userId, input.boardId);
  if (
    !access ||
    !access.archivedAt ||
    (access.role !== "owner" && access.role !== "editor")
  ) {
    throw new BoardApiError(404, "not_found", "The requested board was not found.");
  }
  return db.transaction(async (transaction) => {
    const now = new Date();
    const [board] = await transaction
      .update(boards)
      .set({ archivedAt: null, updatedAt: now })
      .where(
        and(
          eq(boards.id, input.boardId),
          eq(boards.workspaceId, access.workspaceId),
          isNotNull(boards.archivedAt),
        ),
      )
      .returning();
    if (!board) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }
    const [projection] = await transaction
      .select({
        projectName: projects.name,
        favoritedAt: boardUserPreferences.favoritedAt,
        pinnedAt: boardUserPreferences.pinnedAt,
        lastOpenedAt: boardUserPreferences.lastOpenedAt,
      })
      .from(boards)
      .innerJoin(
        projects,
        and(
          eq(projects.id, boards.projectId),
          eq(projects.workspaceId, boards.workspaceId),
        ),
      )
      .leftJoin(
        boardUserPreferences,
        and(
          eq(boardUserPreferences.boardId, boards.id),
          eq(boardUserPreferences.workspaceId, boards.workspaceId),
          eq(boardUserPreferences.userId, input.userId),
        ),
      )
      .where(
        and(
          eq(boards.id, input.boardId),
          eq(boards.workspaceId, access.workspaceId),
        ),
      )
      .limit(1);
    if (!projection) {
      throw new BoardApiError(404, "not_found", "The requested board was not found.");
    }
    return {
      ...board,
      projectName: projection.projectName,
      status: deriveBoardStatus(board.status, board.archivedAt),
      favorite: Boolean(projection.favoritedAt),
      pinned: Boolean(projection.pinnedAt),
      lastOpenedAt: projection.lastOpenedAt,
      role: access.role,
    };
  });
}

export async function updateBoardPreference(input: {
  userId: string;
  boardId: string;
  favorite?: boolean;
  pinned?: boolean;
}) {
  const access = await resolveBoardAccess(input.userId, input.boardId);
  if (!access) throw new BoardApiError(404, "not_found", "The requested board was not found.");
  const now = new Date();
  const [preference] = await db
    .insert(boardUserPreferences)
    .values({
      workspaceId: access.workspaceId,
      boardId: input.boardId,
      userId: input.userId,
      favoritedAt: input.favorite ? now : null,
      pinnedAt: input.pinned ? now : null,
    })
    .onConflictDoUpdate({
      target: [boardUserPreferences.boardId, boardUserPreferences.userId],
      set: {
        ...(input.favorite !== undefined ? { favoritedAt: input.favorite ? now : null } : {}),
        ...(input.pinned !== undefined ? { pinnedAt: input.pinned ? now : null } : {}),
        updatedAt: now,
      },
    })
    .returning({
      favoritedAt: boardUserPreferences.favoritedAt,
      pinnedAt: boardUserPreferences.pinnedAt,
    });
  if (!preference) throw new Error("Board preference upsert returned no row.");
  return { favorite: Boolean(preference.favoritedAt), pinned: Boolean(preference.pinnedAt) };
}

export async function updateBoardDocument(input: {
  userId: string;
  boardId: string;
  expectedRevision: number;
  expectedDocumentGenerationId: string;
  document: BoardDocument;
}) {
  await requireBoardCapability(input.userId, input.boardId, "edit_board");
  const [updated] = await db
    .update(boards)
    .set({
      document: input.document,
      revision: sql`${boards.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(boards.id, input.boardId),
        eq(boards.revision, input.expectedRevision),
        eq(boards.documentGenerationId, input.expectedDocumentGenerationId),
      ),
    )
    .returning({
      id: boards.id,
      document: boards.document,
      revision: boards.revision,
      documentGenerationId: boards.documentGenerationId,
      updatedAt: boards.updatedAt,
    });

  if (updated) return updated;

  const [current] = await db
    .select({
      revision: boards.revision,
      documentGenerationId: boards.documentGenerationId,
    })
    .from(boards)
    .where(eq(boards.id, input.boardId))
    .limit(1);
  if (!current) throw new BoardApiError(404, "not_found", "The requested board was not found.");
  throw new BoardApiError(
    409,
    "revision_conflict",
    "The board changed since this document was loaded.",
    current,
  );
}

export async function listCommentThreads(userId: string, boardId: string) {
  await requireBoardCapability(userId, boardId, "view");
  const threads = await db
    .select({
      id: boardCommentThreads.id,
      anchor: boardCommentThreads.anchor,
      createdBy: boardCommentThreads.createdBy,
      creatorName: users.name,
      creatorAvatar: userAvatarSelection,
      resolvedAt: boardCommentThreads.resolvedAt,
      resolvedBy: boardCommentThreads.resolvedBy,
      createdAt: boardCommentThreads.createdAt,
      updatedAt: boardCommentThreads.updatedAt,
    })
    .from(boardCommentThreads)
    .innerJoin(users, eq(users.id, boardCommentThreads.createdBy))
    .where(eq(boardCommentThreads.boardId, boardId))
    .orderBy(asc(boardCommentThreads.createdAt));

  if (threads.length === 0) return [];
  const comments = await db
    .select({
      id: boardComments.id,
      threadId: boardComments.threadId,
      authorId: boardComments.authorId,
      authorName: users.name,
      authorAvatar: userAvatarSelection,
      body: boardComments.body,
      createdAt: boardComments.createdAt,
      updatedAt: boardComments.updatedAt,
      deletedAt: boardComments.deletedAt,
    })
    .from(boardComments)
    .innerJoin(users, eq(users.id, boardComments.authorId))
    .where(inArray(boardComments.threadId, threads.map((thread) => thread.id)))
    .orderBy(asc(boardComments.createdAt));

  return threads.map(({ creatorAvatar, ...thread }) => ({
    ...thread,
    creatorImage: resolveUserAvatar(creatorAvatar).image,
    comments: comments
      .filter((comment) => comment.threadId === thread.id)
      .map(({ authorAvatar, ...comment }) => ({
        ...comment,
        authorImage: resolveUserAvatar(authorAvatar).image,
        body: comment.deletedAt ? null : comment.body,
      })),
  }));
}

export async function createCommentThread(input: {
  userId: string;
  boardId: string;
  anchor: CommentAnchor;
  body: string;
}) {
  await requireBoardCapability(input.userId, input.boardId, "comment");
  return db.transaction(async (transaction) => {
    const [thread] = await transaction
      .insert(boardCommentThreads)
      .values({ boardId: input.boardId, anchor: input.anchor, createdBy: input.userId })
      .returning();
    if (!thread) throw new Error("Comment thread insert returned no row.");
    const [comment] = await transaction
      .insert(boardComments)
      .values({ threadId: thread.id, authorId: input.userId, body: input.body })
      .returning();
    if (!comment) throw new Error("Comment insert returned no row.");
    return { ...thread, comments: [comment] };
  });
}

export async function replyToCommentThread(input: {
  userId: string;
  boardId: string;
  threadId: string;
  body: string;
}) {
  await requireBoardCapability(input.userId, input.boardId, "comment");
  const [thread] = await db
    .select({ id: boardCommentThreads.id, resolvedAt: boardCommentThreads.resolvedAt })
    .from(boardCommentThreads)
    .where(
      and(eq(boardCommentThreads.id, input.threadId), eq(boardCommentThreads.boardId, input.boardId)),
    )
    .limit(1);
  if (!thread) throw new BoardApiError(404, "not_found", "The comment thread was not found.");
  if (thread.resolvedAt) {
    throw new BoardApiError(409, "thread_resolved", "Reopen the thread before replying.");
  }

  const [comment] = await db
    .insert(boardComments)
    .values({ threadId: input.threadId, authorId: input.userId, body: input.body })
    .returning();
  if (!comment) throw new Error("Comment insert returned no row.");
  await db
    .update(boardCommentThreads)
    .set({ updatedAt: new Date() })
    .where(eq(boardCommentThreads.id, input.threadId));
  return comment;
}

export async function setCommentThreadResolution(input: {
  userId: string;
  boardId: string;
  threadId: string;
  resolved: boolean;
}) {
  await requireBoardCapability(input.userId, input.boardId, "resolve_comment");
  const now = new Date();
  const [thread] = await db
    .update(boardCommentThreads)
    .set({
      resolvedAt: input.resolved ? now : null,
      resolvedBy: input.resolved ? input.userId : null,
      updatedAt: now,
    })
    .where(
      and(eq(boardCommentThreads.id, input.threadId), eq(boardCommentThreads.boardId, input.boardId)),
    )
    .returning();
  if (!thread) throw new BoardApiError(404, "not_found", "The comment thread was not found.");
  return thread;
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function listShareLinks(userId: string, boardId: string) {
  await requireBoardCapability(userId, boardId, "manage_sharing");
  return db
    .select({
      id: boardShareLinks.id,
      permission: boardShareLinks.permission,
      expiresAt: boardShareLinks.expiresAt,
      revokedAt: boardShareLinks.revokedAt,
      lastUsedAt: boardShareLinks.lastUsedAt,
      createdAt: boardShareLinks.createdAt,
    })
    .from(boardShareLinks)
    .where(eq(boardShareLinks.boardId, boardId))
    .orderBy(desc(boardShareLinks.createdAt));
}

export async function createShareLink(input: {
  userId: string;
  boardId: string;
  permission: ShareLinkPermission;
  expiresAt?: Date | null;
}) {
  await requireBoardCapability(input.userId, input.boardId, "manage_sharing");
  if (input.expiresAt && input.expiresAt <= new Date()) {
    throw new BoardApiError(422, "invalid_expiry", "The share link expiry must be in the future.");
  }
  const token = randomBytes(32).toString("base64url");
  const [link] = await db
    .insert(boardShareLinks)
    .values({
      boardId: input.boardId,
      tokenHash: hashShareToken(token),
      permission: input.permission,
      createdBy: input.userId,
      expiresAt: input.expiresAt,
    })
    .returning({
      id: boardShareLinks.id,
      permission: boardShareLinks.permission,
      expiresAt: boardShareLinks.expiresAt,
      createdAt: boardShareLinks.createdAt,
    });
  if (!link) throw new Error("Share link insert returned no row.");
  return { ...link, token, path: `/share/${token}` };
}

export async function revokeShareLink(input: {
  userId: string;
  boardId: string;
  linkId: string;
}) {
  await requireBoardCapability(input.userId, input.boardId, "manage_sharing");
  const [link] = await db
    .update(boardShareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(boardShareLinks.id, input.linkId), eq(boardShareLinks.boardId, input.boardId)))
    .returning({ id: boardShareLinks.id, revokedAt: boardShareLinks.revokedAt });
  if (!link) throw new BoardApiError(404, "not_found", "The share link was not found.");
  return link;
}

export async function listWorkspaceMembers(userId: string, workspaceId: string) {
  const role = await requireWorkspaceCapability(userId, workspaceId, "view");
  const members = await db
    .select({
      userId: workspaceMemberships.userId,
      role: workspaceMemberships.role,
      name: users.name,
      email: users.email,
      avatar: userAvatarSelection,
      createdAt: workspaceMemberships.createdAt,
    })
    .from(workspaceMemberships)
    .innerJoin(users, eq(users.id, workspaceMemberships.userId))
    .where(eq(workspaceMemberships.workspaceId, workspaceId))
    .orderBy(asc(workspaceMemberships.createdAt));
  return members.map(({ avatar, ...member }) => ({
    ...member,
    image: resolveUserAvatar(avatar).image,
    email: role === "owner" ? member.email : undefined,
  }));
}

export async function addWorkspaceMember(input: {
  actorId: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
}) {
  await requireWorkspaceCapability(input.actorId, input.workspaceId, "manage_members");
  const [target] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatar: userAvatarSelection,
    })
    .from(users)
    .innerJoin(accounts, eq(accounts.userId, users.id))
    .where(
      and(
        sql`lower(${users.email}) = ${input.email.toLowerCase()}`,
        isNull(users.suspendedAt),
      ),
    )
    .limit(1);
  if (!target) {
    throw new BoardApiError(
      404,
      "user_not_found",
      "No active Fabric account matches that email address.",
    );
  }
  const [member] = await db
    .insert(workspaceMemberships)
    .values({ workspaceId: input.workspaceId, userId: target.id, role: input.role })
    .onConflictDoNothing()
    .returning();
  if (!member) {
    throw new BoardApiError(409, "member_exists", "This user is already a workspace member.");
  }
  return {
    ...member,
    name: target.name,
    email: target.email,
    image: resolveUserAvatar(target.avatar).image,
  };
}

export async function updateWorkspaceMember(input: {
  actorId: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}) {
  await requireWorkspaceCapability(input.actorId, input.workspaceId, "manage_members");
  return db.transaction(async (transaction) => {
    const lockedMembers = await transaction
      .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, input.workspaceId))
      .orderBy(asc(workspaceMemberships.userId))
      .for("update");
    const target = lockedMembers.find((member) => member.userId === input.userId);
    if (!target) throw new BoardApiError(404, "not_found", "The workspace member was not found.");

    if (
      target.role === "owner" &&
      input.role !== "owner" &&
      lockedMembers.filter((member) => member.role === "owner").length <= 1
    ) {
      throw new BoardApiError(409, "last_owner", "A workspace must keep at least one owner.");
    }

    const [member] = await transaction
      .update(workspaceMemberships)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          eq(workspaceMemberships.userId, input.userId),
        ),
      )
      .returning();
    if (!member) throw new BoardApiError(404, "not_found", "The workspace member was not found.");
    const revocation = workspaceMemberRoleChangedRevocation({
      workspaceId: input.workspaceId,
      principalId: input.userId,
      previousRole: target.role,
      nextRole: input.role,
    });
    if (revocation) {
      await transaction.insert(realtimeRevocationOutbox).values(revocation);
    }
    return member;
  });
}

export async function removeWorkspaceMember(input: {
  actorId: string;
  workspaceId: string;
  userId: string;
}) {
  await requireWorkspaceCapability(input.actorId, input.workspaceId, "manage_members");
  return db.transaction(async (transaction) => {
    const lockedMembers = await transaction
      .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(eq(workspaceMemberships.workspaceId, input.workspaceId))
      .orderBy(asc(workspaceMemberships.userId))
      .for("update");
    const target = lockedMembers.find((member) => member.userId === input.userId);
    if (!target) throw new BoardApiError(404, "not_found", "The workspace member was not found.");

    if (
      target.role === "owner" &&
      lockedMembers.filter((member) => member.role === "owner").length <= 1
    ) {
      throw new BoardApiError(409, "last_owner", "A workspace must keep at least one owner.");
    }

    const [ownedBoard] = await transaction
      .select({ id: boards.id })
      .from(boards)
      .where(
        and(
          eq(boards.workspaceId, input.workspaceId),
          eq(boards.ownerId, input.userId),
        ),
      )
      .limit(1);
    if (ownedBoard) {
      throw new BoardApiError(
        409,
        "board_owner",
        "Transfer this member's boards before removing them from the workspace.",
      );
    }

    const [removed] = await transaction
      .delete(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          eq(workspaceMemberships.userId, input.userId),
        ),
      )
      .returning({ userId: workspaceMemberships.userId });
    if (!removed) throw new BoardApiError(404, "not_found", "The workspace member was not found.");
    await transaction.insert(realtimeRevocationOutbox).values(
      workspaceMemberRemovedRevocation({
        workspaceId: input.workspaceId,
        principalId: input.userId,
        previousRole: target.role,
      }),
    );
    return removed;
  });
}
