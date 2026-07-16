import "server-only";

import { randomUUID } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { users } from "@/db/schema/auth";
import { boardCheckpoints } from "@/db/schema/checkpoints";
import { realtimeRevocationOutbox } from "@/db/schema/collaboration";
import { boards } from "@/db/schema/product";
import { resolveUserAvatar } from "@/lib/account/avatar-contracts";
import { userAvatarSelection } from "@/lib/account/avatar-db";
import { requireBoardCapability } from "@/lib/boards/authorization";
import { checkpointCapability } from "@/lib/boards/checkpoint-policy";
import { BoardApiError } from "@/lib/boards/http";
import { boardGenerationReplacedRevocation } from "@/lib/realtime/revocation-events";

const checkpointMetadata = {
  id: boardCheckpoints.id,
  boardId: boardCheckpoints.boardId,
  name: boardCheckpoints.name,
  sourceDocumentGenerationId: boardCheckpoints.sourceDocumentGenerationId,
  sourceRevision: boardCheckpoints.sourceRevision,
  createdBy: boardCheckpoints.createdBy,
  creatorName: users.name,
  creatorAvatar: userAvatarSelection,
  createdAt: boardCheckpoints.createdAt,
  updatedAt: boardCheckpoints.updatedAt,
};

function resolveCheckpointAvatar<
  T extends { creatorAvatar: Parameters<typeof resolveUserAvatar>[0] },
>(checkpoint: T) {
  const { creatorAvatar, ...metadata } = checkpoint;
  return { ...metadata, creatorImage: resolveUserAvatar(creatorAvatar).image };
}

export async function listBoardCheckpoints(userId: string, boardId: string) {
  await requireBoardCapability(userId, boardId, checkpointCapability("list"));

  const checkpoints = await db
    .select(checkpointMetadata)
    .from(boardCheckpoints)
    .innerJoin(users, eq(users.id, boardCheckpoints.createdBy))
    .where(eq(boardCheckpoints.boardId, boardId))
    .orderBy(desc(boardCheckpoints.createdAt), desc(boardCheckpoints.id));
  return checkpoints.map(resolveCheckpointAvatar);
}

export async function createBoardCheckpoint(input: {
  userId: string;
  boardId: string;
  name: string;
}) {
  await requireBoardCapability(input.userId, input.boardId, checkpointCapability("create"));

  return db.transaction(async (transaction) => {
    const [board] = await transaction
      .select({
        document: boards.document,
        documentGenerationId: boards.documentGenerationId,
        revision: boards.revision,
      })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), isNull(boards.archivedAt)))
      .for("update");

    if (!board) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }

    const [inserted] = await transaction
      .insert(boardCheckpoints)
      .values({
        boardId: input.boardId,
        name: input.name,
        document: board.document,
        sourceDocumentGenerationId: board.documentGenerationId,
        sourceRevision: board.revision,
        createdBy: input.userId,
      })
      .returning({ id: boardCheckpoints.id });

    if (!inserted) throw new Error("Board checkpoint insert returned no row.");

    const [created] = await transaction
      .select(checkpointMetadata)
      .from(boardCheckpoints)
      .innerJoin(users, eq(users.id, boardCheckpoints.createdBy))
      .where(
        and(
          eq(boardCheckpoints.id, inserted.id),
          eq(boardCheckpoints.boardId, input.boardId),
        ),
      )
      .limit(1);

    if (!created) throw new Error("Board checkpoint metadata could not be loaded.");
    return resolveCheckpointAvatar(created);
  });
}

export async function restoreBoardCheckpoint(input: {
  userId: string;
  boardId: string;
  checkpointId: string;
}) {
  const { role } = await requireBoardCapability(
    input.userId,
    input.boardId,
    checkpointCapability("restore"),
  );

  return db.transaction(async (transaction) => {
    const [lockedBoard] = await transaction
      .select({
        id: boards.id,
        workspaceId: boards.workspaceId,
        documentGenerationId: boards.documentGenerationId,
      })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), isNull(boards.archivedAt)))
      .for("update");

    if (!lockedBoard) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }

    const [checkpoint] = await transaction
      .select({ document: boardCheckpoints.document })
      .from(boardCheckpoints)
      .where(
        and(
          eq(boardCheckpoints.id, input.checkpointId),
          eq(boardCheckpoints.boardId, input.boardId),
        ),
      )
      .limit(1);

    if (!checkpoint) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }

    const [restored] = await transaction
      .update(boards)
      .set({
        document: checkpoint.document,
        documentGenerationId: randomUUID(),
        revision: sql`${boards.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(boards.id, input.boardId))
      .returning({
        id: boards.id,
        document: boards.document,
        revision: boards.revision,
        documentGenerationId: boards.documentGenerationId,
        updatedAt: boards.updatedAt,
      });

    if (!restored) {
      throw new BoardApiError(404, "not_found", "The requested resource was not found.");
    }

    await transaction.insert(realtimeRevocationOutbox).values(
      boardGenerationReplacedRevocation({
        workspaceId: lockedBoard.workspaceId,
        boardId: input.boardId,
        previousDocumentGenerationId: lockedBoard.documentGenerationId,
      }),
    );

    return { ...restored, role };
  });
}
