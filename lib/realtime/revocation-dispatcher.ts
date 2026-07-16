import "server-only";

import { randomUUID } from "node:crypto";

import { getRealtimeRevocationDispatchEnvironment } from "@/lib/realtime/revocation-dispatch-environment";
import {
  realtimeRevocationRepository,
  type ConcreteRoomRevocation,
  type RealtimeRevocationRepository,
} from "@/lib/realtime/revocation-repository";

export const REALTIME_REVOCATION_BATCH_LIMIT = 8;
export const REALTIME_REVOCATION_ROOM_PAGE_LIMIT = 25;
export const REALTIME_REVOCATION_PAGES_PER_EVENT = 4;
const REALTIME_REVOCATION_CONCURRENCY = 3;
const REALTIME_REVOCATION_LEASE_MS = 2 * 60_000;
const REALTIME_REVOCATION_MIN_RETRY_MS = 15_000;
const REALTIME_REVOCATION_MAX_RETRY_MS = 15 * 60_000;

type Dependencies = Readonly<{
  repository: RealtimeRevocationRepository;
  deliver: (workspaceId: string, targets: ConcreteRoomRevocation[]) => Promise<void>;
  now: () => Date;
  uuid: () => string;
}>;

async function deliverWithFetch(
  workspaceId: string,
  targets: ConcreteRoomRevocation[],
): Promise<void> {
  const environment = getRealtimeRevocationDispatchEnvironment();
  const response = await fetch(environment.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${environment.coordinatorSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspaceId, targets }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`coordinator_http_${response.status}`);
  }
}

const defaultDependencies = (): Dependencies => ({
  repository: realtimeRevocationRepository,
  deliver: deliverWithFetch,
  now: () => new Date(),
  uuid: randomUUID,
});

export function realtimeRevocationRetryAt(now: Date, attempt: number): Date {
  const exponent = Math.min(Math.max(attempt - 1, 0), 6);
  return new Date(
    now.getTime() +
      Math.min(
        REALTIME_REVOCATION_MIN_RETRY_MS * 2 ** exponent,
        REALTIME_REVOCATION_MAX_RETRY_MS,
      ),
  );
}

export function realtimeRevocationErrorCode(error: unknown): string {
  if (error instanceof Error) {
    if (/^coordinator_http_[45][0-9]{2}$/.test(error.message)) return error.message;
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return "coordinator_timeout";
    }
  }
  return "coordinator_delivery_failed";
}

export async function runRealtimeRevocationDispatch(
  dependencies: Dependencies = defaultDependencies(),
): Promise<Readonly<{
  claimedEvents: number;
  deliveredEvents: number;
  continuedEvents: number;
  failedEvents: number;
  deliveredRooms: number;
}>> {
  const startedAt = dependencies.now();
  const leaseOwner = dependencies.uuid();
  const events = await dependencies.repository.claim({
    now: startedAt,
    limit: REALTIME_REVOCATION_BATCH_LIMIT,
    leaseOwner,
    leaseExpiresAt: new Date(startedAt.getTime() + REALTIME_REVOCATION_LEASE_MS),
  });

  let deliveredEvents = 0;
  let continuedEvents = 0;
  let failedEvents = 0;
  let deliveredRooms = 0;
  let cursor = 0;
  const workerCount = Math.min(REALTIME_REVOCATION_CONCURRENCY, events.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < events.length) {
        const event = events[cursor++];
        if (!event) return;
        let afterBoardId = event.cursorBoardId;
        try {
          let hasMore = false;
          for (let pageIndex = 0; pageIndex < REALTIME_REVOCATION_PAGES_PER_EVENT; pageIndex += 1) {
            const page = await dependencies.repository.loadRoomPage({
              event,
              afterBoardId,
              limit: REALTIME_REVOCATION_ROOM_PAGE_LIMIT,
            });
            if (page.targets.length > 0) {
              await dependencies.deliver(event.workspaceId, page.targets);
              deliveredRooms += page.targets.length;
            }
            hasMore = page.hasMore;
            if (!hasMore) break;
            if (!page.lastBoardId) throw new Error("revocation_cursor_missing");
            const checkpointed = await dependencies.repository.checkpointPage({
              id: event.id,
              leaseOwner,
              cursorBoardId: page.lastBoardId,
              now: dependencies.now(),
            });
            if (!checkpointed) throw new Error("revocation_lease_lost");
            afterBoardId = page.lastBoardId;
          }

          if (hasMore) {
            const continued = await dependencies.repository.continueLater({
              id: event.id,
              leaseOwner,
              now: dependencies.now(),
            });
            if (!continued) throw new Error("revocation_lease_lost");
            continuedEvents += 1;
          } else {
            const completed = await dependencies.repository.complete({
              id: event.id,
              leaseOwner,
              now: dependencies.now(),
            });
            if (!completed) throw new Error("revocation_lease_lost");
            deliveredEvents += 1;
          }
        } catch (error) {
          failedEvents += 1;
          const failedAt = dependencies.now();
          await dependencies.repository.retry({
            id: event.id,
            leaseOwner,
            now: failedAt,
            nextAttemptAt: realtimeRevocationRetryAt(failedAt, event.attempt),
            errorCode: realtimeRevocationErrorCode(error),
          });
        }
      }
    }),
  );

  return {
    claimedEvents: events.length,
    deliveredEvents,
    continuedEvents,
    failedEvents,
    deliveredRooms,
  };
}
