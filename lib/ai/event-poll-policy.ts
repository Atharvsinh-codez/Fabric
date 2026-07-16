const ACTIVE_POLL_BASE_MS = 250;
const ACTIVE_POLL_MAX_MS = 2_000;

/**
 * Keeps a newly active stream responsive, then backs off quickly while the
 * durable worker has no new events. The idle cap bounds Neon reads to one
 * request every two seconds per open AI stream.
 */
export function aiEventPollDelayMs(consecutiveEmptyPolls: number): number {
  const boundedEmptyPolls = Math.max(0, Math.min(3, Math.floor(consecutiveEmptyPolls)));
  return Math.min(
    ACTIVE_POLL_MAX_MS,
    ACTIVE_POLL_BASE_MS * 2 ** boundedEmptyPolls,
  );
}
