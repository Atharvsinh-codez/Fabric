import "server-only";

import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/db/clients/web";
import {
  realtimeRevocationOutbox,
  type RealtimeRevocationEventType,
  type RealtimeRevocationScope,
} from "@/db/schema/collaboration";
import { boards } from "@/db/schema/product";

export const REALTIME_REVOCATION_MAX_ATTEMPTS = 100;

export type ClaimedRealtimeRevocation = Readonly<{
  id: string;
  eventType: RealtimeRevocationEventType;
  scope: RealtimeRevocationScope;
  workspaceId: string;
  projectId: string | null;
  boardId: string | null;
  documentGenerationId: string | null;
  principalId: string | null;
  cursorBoardId: string | null;
  attempt: number;
  occurredAt: Date;
}>;

export type RealtimeRevocationAction = "revoke" | "reauthorize";

export type ConcreteRoomRevocation = Readonly<{
  eventId: string;
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  principalId: string | null;
  action: RealtimeRevocationAction;
  reason: RealtimeRevocationEventType;
  invalidBefore: number;
  invalidBeforeMs: number;
}>;

export type ConcreteRoomRevocationPage = Readonly<{
  targets: ConcreteRoomRevocation[];
  lastBoardId: string | null;
  hasMore: boolean;
}>;

export interface RealtimeRevocationRepository {
  claim(input: {
    now: Date;
    limit: number;
    leaseOwner: string;
    leaseExpiresAt: Date;
  }): Promise<ClaimedRealtimeRevocation[]>;
  loadRoomPage(input: {
    event: ClaimedRealtimeRevocation;
    afterBoardId: string | null;
    limit: number;
  }): Promise<ConcreteRoomRevocationPage>;
  checkpointPage(input: {
    id: string;
    leaseOwner: string;
    cursorBoardId: string;
    now: Date;
  }): Promise<boolean>;
  complete(input: { id: string; leaseOwner: string; now: Date }): Promise<boolean>;
  continueLater(input: {
    id: string;
    leaseOwner: string;
    now: Date;
  }): Promise<boolean>;
  retry(input: {
    id: string;
    leaseOwner: string;
    now: Date;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<boolean>;
}

function actionForEvent(eventType: RealtimeRevocationEventType): RealtimeRevocationAction {
  return eventType === "workspace.member_removed" || eventType === "board.archived"
    ? "revoke"
    : "reauthorize";
}

function targetFor(
  event: ClaimedRealtimeRevocation,
  board: { id: string; documentGenerationId: string },
): ConcreteRoomRevocation {
  const invalidBeforeMs = event.occurredAt.getTime();
  return {
    eventId: event.id,
    workspaceId: event.workspaceId,
    boardId: board.id,
    documentGenerationId: board.documentGenerationId,
    principalId: event.principalId,
    action: actionForEvent(event.eventType),
    reason: event.eventType,
    invalidBefore: Math.floor(invalidBeforeMs / 1_000),
    invalidBeforeMs,
  };
}

export const realtimeRevocationRepository: RealtimeRevocationRepository = {
  async claim(input) {
    return db.transaction(async (transaction) => {
      const candidates = await transaction
        .select({ id: realtimeRevocationOutbox.id })
        .from(realtimeRevocationOutbox)
        .where(
          and(
            isNull(realtimeRevocationOutbox.deliveredAt),
            lte(realtimeRevocationOutbox.nextAttemptAt, input.now),
            lt(realtimeRevocationOutbox.attempts, REALTIME_REVOCATION_MAX_ATTEMPTS),
            or(
              isNull(realtimeRevocationOutbox.leaseExpiresAt),
              lte(realtimeRevocationOutbox.leaseExpiresAt, input.now),
            ),
          ),
        )
        .orderBy(
          asc(realtimeRevocationOutbox.nextAttemptAt),
          asc(realtimeRevocationOutbox.createdAt),
          asc(realtimeRevocationOutbox.id),
        )
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];

      return transaction
        .update(realtimeRevocationOutbox)
        .set({
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: input.leaseExpiresAt,
          attempts: sql`${realtimeRevocationOutbox.attempts} + 1`,
          updatedAt: input.now,
        })
        .where(inArray(realtimeRevocationOutbox.id, candidates.map(({ id }) => id)))
        .returning({
          id: realtimeRevocationOutbox.id,
          eventType: realtimeRevocationOutbox.eventType,
          scope: realtimeRevocationOutbox.scope,
          workspaceId: realtimeRevocationOutbox.workspaceId,
          projectId: realtimeRevocationOutbox.projectId,
          boardId: realtimeRevocationOutbox.boardId,
          documentGenerationId: realtimeRevocationOutbox.documentGenerationId,
          principalId: realtimeRevocationOutbox.principalId,
          cursorBoardId: realtimeRevocationOutbox.cursorBoardId,
          attempt: realtimeRevocationOutbox.attempts,
          occurredAt: realtimeRevocationOutbox.createdAt,
        });
    });
  },

  async loadRoomPage(input) {
    const { event } = input;
    if (event.scope === "board") {
      if (!event.boardId || !event.documentGenerationId) return emptyPage();
      return {
        targets: [
          targetFor(event, {
            id: event.boardId,
            documentGenerationId: event.documentGenerationId,
          }),
        ],
        lastBoardId: event.boardId,
        hasMore: false,
      };
    }

    const rows = await db
      .select({ id: boards.id, documentGenerationId: boards.documentGenerationId })
      .from(boards)
      .where(
        and(
          eq(boards.workspaceId, event.workspaceId),
          event.scope === "project" && event.projectId
            ? and(
                eq(boards.projectId, event.projectId),
                eq(boards.sharingPolicy, "project"),
              )
            : undefined,
          input.afterBoardId ? gt(boards.id, input.afterBoardId) : undefined,
        ),
      )
      .orderBy(asc(boards.id))
      .limit(input.limit + 1);
    const pageRows = rows.slice(0, input.limit);
    return {
      targets: pageRows.map((board) => targetFor(event, board)),
      lastBoardId: pageRows.at(-1)?.id ?? null,
      hasMore: rows.length > input.limit,
    };
  },

  async checkpointPage(input) {
    const [updated] = await db
      .update(realtimeRevocationOutbox)
      .set({
        cursorBoardId: input.cursorBoardId,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeRevocationOutbox.id, input.id),
          eq(realtimeRevocationOutbox.leaseOwner, input.leaseOwner),
          isNull(realtimeRevocationOutbox.deliveredAt),
        ),
      )
      .returning({ id: realtimeRevocationOutbox.id });
    return Boolean(updated);
  },

  async complete(input) {
    const [updated] = await db
      .update(realtimeRevocationOutbox)
      .set({
        deliveredAt: input.now,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeRevocationOutbox.id, input.id),
          eq(realtimeRevocationOutbox.leaseOwner, input.leaseOwner),
          isNull(realtimeRevocationOutbox.deliveredAt),
        ),
      )
      .returning({ id: realtimeRevocationOutbox.id });
    return Boolean(updated);
  },

  async continueLater(input) {
    const [updated] = await db
      .update(realtimeRevocationOutbox)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: input.now,
        lastErrorCode: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeRevocationOutbox.id, input.id),
          eq(realtimeRevocationOutbox.leaseOwner, input.leaseOwner),
          isNull(realtimeRevocationOutbox.deliveredAt),
        ),
      )
      .returning({ id: realtimeRevocationOutbox.id });
    return Boolean(updated);
  },

  async retry(input) {
    const [updated] = await db
      .update(realtimeRevocationOutbox)
      .set({
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(realtimeRevocationOutbox.id, input.id),
          eq(realtimeRevocationOutbox.leaseOwner, input.leaseOwner),
          isNull(realtimeRevocationOutbox.deliveredAt),
        ),
      )
      .returning({ id: realtimeRevocationOutbox.id });
    return Boolean(updated);
  },
};

function emptyPage(): ConcreteRoomRevocationPage {
  return { targets: [], lastBoardId: null, hasMore: false };
}
