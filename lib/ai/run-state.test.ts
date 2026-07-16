import { describe, expect, it } from "vitest";

import {
  canClaimAiJob,
  canTransitionAiRun,
  isSettledAiStreamStatus,
  isTerminalAiRunStatus,
  retryDelayMs,
} from "./run-state";

const now = new Date("2026-07-13T12:00:00.000Z");
const queuedJob = {
  status: "queued" as const,
  attempts: 0,
  maxAttempts: 2,
  availableAt: new Date("2026-07-13T11:59:00.000Z"),
  leaseExpiresAt: null,
};
const queuedRun = {
  status: "queued" as const,
  cancelRequestedAt: null,
  deadlineAt: new Date("2026-07-13T12:01:00.000Z"),
};

describe("durable AI run policy", () => {
  it("claims available jobs and safely recovers an expired lease", () => {
    expect(canClaimAiJob(queuedJob, queuedRun, now)).toBe(true);
    expect(
      canClaimAiJob(
        {
          ...queuedJob,
          status: "leased",
          attempts: 1,
          leaseExpiresAt: new Date("2026-07-13T11:59:59.000Z"),
        },
        queuedRun,
        now,
      ),
    ).toBe(true);
  });

  it("never claims canceled, expired, exhausted, or proposal-ready work", () => {
    expect(
      canClaimAiJob(queuedJob, { ...queuedRun, cancelRequestedAt: now }, now),
    ).toBe(false);
    expect(canClaimAiJob(queuedJob, { ...queuedRun, deadlineAt: now }, now)).toBe(false);
    expect(canClaimAiJob({ ...queuedJob, attempts: 2 }, queuedRun, now)).toBe(false);
    expect(
      canClaimAiJob(queuedJob, { ...queuedRun, status: "waiting_for_approval" }, now),
    ).toBe(false);
  });

  it("keeps terminal states terminal and proposal-ready streams settled", () => {
    expect(isTerminalAiRunStatus("provider_unavailable")).toBe(true);
    expect(isSettledAiStreamStatus("waiting_for_approval")).toBe(true);
    expect(canTransitionAiRun("calling_model", "building_proposal")).toBe(true);
    expect(canTransitionAiRun("completed", "calling_model")).toBe(false);
  });

  it("bounds retry backoff", () => {
    expect(retryDelayMs(1, 0)).toBe(1_000);
    expect(retryDelayMs(99, 0.2)).toBe(36_000);
  });
});
