import "server-only";

import { createHash } from "node:crypto";

import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { users } from "@/db/schema/auth";
import {
  boardComments,
  boardCommentThreads,
  boardShareLinks,
  boards,
  type CommentAnchor,
} from "@/db/schema/product";
import { resolveUserAvatar } from "@/lib/account/avatar-contracts";
import { userAvatarSelection } from "@/lib/account/avatar-db";
import { PublicShareTokenSchema } from "@/lib/boards/contracts";
import { BoardApiError } from "@/lib/boards/http";

function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function unavailableShare(): BoardApiError {
  return new BoardApiError(
    404,
    "not_found",
    "This shared board is unavailable.",
  );
}

function parseShareToken(token: string): string {
  const parsed = PublicShareTokenSchema.safeParse(token);
  if (!parsed.success) throw unavailableShare();
  return parsed.data;
}

function activeShareConditions(tokenHash: string, now: Date) {
  return and(
    eq(boardShareLinks.tokenHash, tokenHash),
    isNull(boardShareLinks.revokedAt),
    isNull(boards.archivedAt),
    isNull(boards.deletedAt),
    or(isNull(boardShareLinks.expiresAt), gt(boardShareLinks.expiresAt, now)),
  );
}

export async function listPublicShareCommentThreads(token: string) {
  const tokenHash = hashShareToken(parseShareToken(token));
  const [share] = await db
    .select({
      boardId: boardShareLinks.boardId,
      permission: boardShareLinks.permission,
    })
    .from(boardShareLinks)
    .innerJoin(boards, eq(boards.id, boardShareLinks.boardId))
    .where(activeShareConditions(tokenHash, new Date()))
    .limit(1);
  if (!share) throw unavailableShare();

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
    .where(eq(boardCommentThreads.boardId, share.boardId))
    .orderBy(asc(boardCommentThreads.createdAt));

  if (threads.length === 0) {
    return { permission: share.permission, threads: [] };
  }

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

  return {
    permission: share.permission,
    threads: threads.map(({ creatorAvatar, ...thread }) => ({
      ...thread,
      creatorImage: resolveUserAvatar(creatorAvatar).image,
      comments: comments
        .filter((comment) => comment.threadId === thread.id)
        .map(({ authorAvatar, ...comment }) => ({
          ...comment,
          authorImage: resolveUserAvatar(authorAvatar).image,
          body: comment.deletedAt ? null : comment.body,
        })),
    })),
  };
}

export async function createPublicShareComment(input: {
  token: string;
  userId: string;
  comment:
    | { kind: "thread"; anchor: CommentAnchor; body: string }
    | { kind: "reply"; threadId: string; body: string };
}) {
  const tokenHash = hashShareToken(parseShareToken(input.token));

  return db.transaction(async (transaction) => {
    const [share] = await transaction
      .select({ boardId: boardShareLinks.boardId })
      .from(boardShareLinks)
      .innerJoin(boards, eq(boards.id, boardShareLinks.boardId))
      .where(
        and(
          activeShareConditions(tokenHash, new Date()),
          eq(boardShareLinks.permission, "commenter"),
        ),
      )
      .for("update");
    if (!share) throw unavailableShare();

    if (input.comment.kind === "thread") {
      const [thread] = await transaction
        .insert(boardCommentThreads)
        .values({
          boardId: share.boardId,
          anchor: input.comment.anchor,
          createdBy: input.userId,
        })
        .returning();
      if (!thread) throw new Error("Comment thread insert returned no row.");

      const [comment] = await transaction
        .insert(boardComments)
        .values({
          threadId: thread.id,
          authorId: input.userId,
          body: input.comment.body,
        })
        .returning();
      if (!comment) throw new Error("Comment insert returned no row.");
      return { ...thread, comments: [comment] };
    }

    const [thread] = await transaction
      .select({
        id: boardCommentThreads.id,
        resolvedAt: boardCommentThreads.resolvedAt,
      })
      .from(boardCommentThreads)
      .where(
        and(
          eq(boardCommentThreads.id, input.comment.threadId),
          eq(boardCommentThreads.boardId, share.boardId),
        ),
      )
      .for("update");
    if (!thread) {
      throw new BoardApiError(404, "not_found", "The comment thread was not found.");
    }
    if (thread.resolvedAt) {
      throw new BoardApiError(
        409,
        "thread_resolved",
        "This comment thread is resolved.",
      );
    }

    const [comment] = await transaction
      .insert(boardComments)
      .values({
        threadId: thread.id,
        authorId: input.userId,
        body: input.comment.body,
      })
      .returning();
    if (!comment) throw new Error("Comment insert returned no row.");

    await transaction
      .update(boardCommentThreads)
      .set({ updatedAt: new Date() })
      .where(eq(boardCommentThreads.id, thread.id));
    return comment;
  });
}
