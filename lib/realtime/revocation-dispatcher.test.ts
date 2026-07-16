import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/realtime/revocation-repository", () => ({
  realtimeRevocationRepository: {},
}));

import {
  realtimeRevocationErrorCode,
  realtimeRevocationRetryAt,
  runRealtimeRevocationDispatch,
} from "./revocation-dispatcher";
import type {
  ClaimedRealtimeRevocation,
  ConcreteRoomRevocation,
  RealtimeRevocationRepository,
} from "./revocation-repository";

const event: ClaimedRealtimeRevocation = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  eventType: "workspace.member_removed",
  scope: "workspace",
  workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  projectId: null,
  boardId: null,
  documentGenerationId: null,
  principalId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  cursorBoardId: null,
  attempt: 1,
  occurredAt: new Date("2026-07-15T11:59:00.000Z"),
};

function target(boardId: string): ConcreteRoomRevocation {
  return {
    eventId: event.id,
    workspaceId: event.workspaceId,
    boardId,
    documentGenerationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    principalId: event.principalId,
    action: "revoke",
    reason: event.eventType,
    invalidBefore: Math.floor(event.occurredAt.getTime() / 1_000),
    invalidBeforeMs: event.occurredAt.getTime(),
  };
}

function repositoryMock(): RealtimeRevocationRepository {
  return {
    claim: vi.fn().mockResolvedValue([event]),
    loadRoomPage: vi.fn(),
    checkpointPage: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    continueLater: vi.fn().mockResolvedValue(true),
    retry: vi.fn().mockResolvedValue(true),
  };
}

describe("realtime revocation dispatcher", () => {
  it("delivers bounded pages, checkpoints acknowledgements, and completes the event", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.loadRoomPage)
      .mockResolvedValueOnce({
        targets: [target("11111111-1111-4111-8111-111111111111")],
        lastBoardId: "11111111-1111-4111-8111-111111111111",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        targets: [target("22222222-2222-4222-8222-222222222222")],
        lastBoardId: "22222222-2222-4222-8222-222222222222",
        hasMore: false,
      });
    const deliver = vi.fn().mockResolvedValue(undefined);
    const now = new Date("2026-07-15T12:00:00.000Z");

    await expect(
      runRealtimeRevocationDispatch({
        repository,
        deliver,
        now: () => now,
        uuid: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      }),
    ).resolves.toEqual({
      claimedEvents: 1,
      deliveredEvents: 1,
      continuedEvents: 0,
      failedEvents: 0,
      deliveredRooms: 2,
    });
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(repository.checkpointPage).toHaveBeenCalledWith({
      id: event.id,
      leaseOwner: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      cursorBoardId: "11111111-1111-4111-8111-111111111111",
      now,
    });
    expect(repository.complete).toHaveBeenCalledOnce();
    expect(repository.retry).not.toHaveBeenCalled();
  });

  it("releases a failed delivery with bounded exponential retry metadata", async () => {
    const repository = repositoryMock();
    vi.mocked(repository.loadRoomPage).mockResolvedValue({
      targets: [target("11111111-1111-4111-8111-111111111111")],
      lastBoardId: "11111111-1111-4111-8111-111111111111",
      hasMore: false,
    });
    const now = new Date("2026-07-15T12:00:00.000Z");

    const result = await runRealtimeRevocationDispatch({
      repository,
      deliver: vi.fn().mockRejectedValue(new Error("coordinator_http_503")),
      now: () => now,
      uuid: () => "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    });

    expect(result).toMatchObject({ failedEvents: 1, deliveredEvents: 0 });
    expect(repository.retry).toHaveBeenCalledWith({
      id: event.id,
      leaseOwner: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      now,
      nextAttemptAt: realtimeRevocationRetryAt(now, 1),
      errorCode: "coordinator_http_503",
    });
    expect(realtimeRevocationErrorCode(new Error("private details"))).toBe(
      "coordinator_delivery_failed",
    );
  });
});
