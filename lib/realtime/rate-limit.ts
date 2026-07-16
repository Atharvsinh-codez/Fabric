import "server-only";

import { lt, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { realtimeTicketMintWindows } from "@/db/schema/collaboration";

import { REALTIME_LIMITS } from "./constants";

const TICKET_WINDOW_RETENTION_MS = 5 * 60_000;
const TICKET_WINDOW_CLEANUP_INTERVAL_MS = 5 * 60_000;

let nextTicketWindowCleanupAt = 0;

async function cleanupExpiredTicketMintWindows(now: Date): Promise<void> {
  if (now.getTime() < nextTicketWindowCleanupAt) {
    return;
  }

  // Move the deadline before awaiting so concurrent requests in the same
  // serverless instance do not all issue the same maintenance query.
  nextTicketWindowCleanupAt = now.getTime() + TICKET_WINDOW_CLEANUP_INTERVAL_MS;

  try {
    await db.delete(realtimeTicketMintWindows).where(
      lt(
        realtimeTicketMintWindows.windowStartedAt,
        new Date(now.getTime() - TICKET_WINDOW_RETENTION_MS),
      ),
    );
  } catch (error) {
    // Rate-limit enforcement is more important than best-effort retention
    // cleanup. Retry maintenance soon without exposing database details.
    nextTicketWindowCleanupAt = now.getTime() + 60_000;
    console.warn("Realtime ticket-window cleanup failed", {
      error: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export async function consumeRealtimeTicketMint(input: {
  principalId: string;
  boardId: string;
  now?: Date;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = input.now ?? new Date();
  await cleanupExpiredTicketMintWindows(now);
  const windowStartedAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const [window] = await db
    .insert(realtimeTicketMintWindows)
    .values({
      principalId: input.principalId,
      boardId: input.boardId,
      windowStartedAt,
      count: 1,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        realtimeTicketMintWindows.principalId,
        realtimeTicketMintWindows.boardId,
        realtimeTicketMintWindows.windowStartedAt,
      ],
      set: {
        count: sql`${realtimeTicketMintWindows.count} + 1`,
        updatedAt: now,
      },
    })
    .returning({ count: realtimeTicketMintWindows.count });

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStartedAt.getTime() + 60_000 - now.getTime()) / 1000),
  );
  return {
    allowed: Boolean(window && window.count <= REALTIME_LIMITS.ticketMintsPerMinute),
    retryAfterSeconds,
  };
}
