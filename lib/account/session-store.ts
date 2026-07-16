import "server-only";

import { and, desc, eq, gt } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { sessionMetadata, sessions } from "@/db/schema/auth";
import {
  buildAccountSessionList,
  findCurrentSessionId,
  type AccountSessionList,
  type StoredAccountSession,
} from "@/lib/account/session-view";

async function selectSessionsForUser(userId: string): Promise<StoredAccountSession[]> {
  return db
    .select({
      id: sessions.id,
      sessionToken: sessions.sessionToken,
      expires: sessions.expires,
      createdAt: sessionMetadata.createdAt,
      lastSeenAt: sessionMetadata.lastSeenAt,
      deviceLabel: sessionMetadata.deviceLabel,
      userAgentFamily: sessionMetadata.userAgentFamily,
    })
    .from(sessions)
    .leftJoin(sessionMetadata, eq(sessionMetadata.sessionId, sessions.id))
    .where(and(eq(sessions.userId, userId), gt(sessions.expires, new Date())))
    .orderBy(desc(sessionMetadata.lastSeenAt), desc(sessions.expires));
}

export async function listAccountSessions(
  userId: string,
  tokenCandidates: readonly string[],
): Promise<AccountSessionList> {
  const storedSessions = await selectSessionsForUser(userId);
  return buildAccountSessionList(storedSessions, tokenCandidates);
}

export type RevokeSessionResult =
  | "revoked"
  | "not_found"
  | "current_session"
  | "current_session_unverified";

export async function revokeOtherAccountSession(
  userId: string,
  sessionId: string,
  tokenCandidates: readonly string[],
): Promise<RevokeSessionResult> {
  return db.transaction(async (transaction) => {
    const ownedSessions = await transaction
      .select({ id: sessions.id, sessionToken: sessions.sessionToken })
      .from(sessions)
      .where(eq(sessions.userId, userId));

    const currentSessionId = findCurrentSessionId(ownedSessions, tokenCandidates);
    if (!currentSessionId) return "current_session_unverified";

    const targetSession = ownedSessions.find((session) => session.id === sessionId);
    if (!targetSession) return "not_found";
    if (targetSession.id === currentSessionId) return "current_session";

    const deletedSessions = await transaction
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ id: sessions.id });

    return deletedSessions.length === 1 ? "revoked" : "not_found";
  });
}
