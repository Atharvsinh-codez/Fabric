import { describe, expect, it } from "vitest";

import { MemoryPendingUpdateOutbox, scopedStorageName } from "./persistence";
import type { PendingUpdate, RealtimeScope } from "./types";

const scope: RealtimeScope = {
  principalId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  documentGenerationId: "33333333-3333-4333-8333-333333333333",
};

const update: PendingUpdate = {
  messageId: "44444444-4444-4444-8444-444444444444",
  payloadHash: "a".repeat(64),
  update: Uint8Array.from([1, 2, 3]),
  createdAt: 100,
  attemptCount: 0,
};

describe("pending realtime update outbox", () => {
  it("retains canonical bytes until a matching ACK", async () => {
    const outbox = new MemoryPendingUpdateOutbox();
    await outbox.put(scope, update);
    await outbox.put(scope, update);
    await outbox.markAttempt(scope, update.messageId, 200);

    expect(
      await outbox.acknowledge(scope, update.messageId, "b".repeat(64)),
    ).toBe("hash_mismatch");
    expect(await outbox.list(scope)).toMatchObject([
      {
        messageId: update.messageId,
        payloadHash: update.payloadHash,
        attemptCount: 1,
      },
    ]);
    expect(
      await outbox.acknowledge(scope, update.messageId, update.payloadHash),
    ).toBe("acknowledged");
    expect(await outbox.list(scope)).toEqual([]);
  });

  it("rejects changed bytes under an immutable message ID", async () => {
    const outbox = new MemoryPendingUpdateOutbox();
    await outbox.put(scope, update);
    await expect(
      outbox.put(scope, { ...update, update: Uint8Array.from([9, 9, 9]) }),
    ).rejects.toThrow("immutable");
  });

  it("atomically compacts only never-attempted updates", async () => {
    const outbox = new MemoryPendingUpdateOutbox();
    const second = {
      ...update,
      messageId: "55555555-5555-4555-8555-555555555555",
      payloadHash: "b".repeat(64),
      update: Uint8Array.from([4, 5, 6]),
      createdAt: 101,
    };
    const replacement = {
      ...update,
      messageId: "66666666-6666-4666-8666-666666666666",
      payloadHash: "c".repeat(64),
      update: Uint8Array.from([7, 8, 9]),
    };
    await outbox.put(scope, update);
    await outbox.put(scope, second);

    await expect(
      outbox.replacePending(scope, [update, second], [replacement]),
    ).resolves.toBe(true);
    expect(await outbox.list(scope)).toEqual([replacement]);

    const attempted = {
      ...second,
      messageId: "77777777-7777-4777-8777-777777777777",
    };
    await outbox.put(scope, attempted);
    await outbox.markAttempt(scope, attempted.messageId, 200);
    const storedAttempted = (await outbox.list(scope)).find(
      (entry) => entry.messageId === attempted.messageId,
    );
    expect(storedAttempted).toBeDefined();
    await expect(
      outbox.replacePending(
        scope,
        [replacement, storedAttempted!],
        [{ ...replacement, messageId: "88888888-8888-4888-8888-888888888888" }],
      ),
    ).resolves.toBe(false);
    expect((await outbox.list(scope)).map((entry) => entry.messageId)).toEqual([
      replacement.messageId,
      attempted.messageId,
    ]);
  });

  it("isolates storage names and records by principal", async () => {
    const otherScope = {
      ...scope,
      principalId: "55555555-5555-4555-8555-555555555555",
    };
    const outbox = new MemoryPendingUpdateOutbox();
    await outbox.put(scope, update);

    expect(await outbox.list(otherScope)).toEqual([]);
    expect(scopedStorageName("document", scope)).not.toBe(
      scopedStorageName("document", otherScope),
    );
  });

  it("advances recovery checkpoints monotonically", async () => {
    const outbox = new MemoryPendingUpdateOutbox();
    const checkpoint = {
      committedSequence: 2,
      stateUpdate: Uint8Array.from([1, 2, 3]),
      payloadHash: "d".repeat(64),
      updatedAt: 200,
    };

    await expect(
      outbox.advanceRecoveryCheckpoint(scope, checkpoint),
    ).resolves.toBe("advanced");
    await expect(
      outbox.advanceRecoveryCheckpoint(scope, {
        ...checkpoint,
        updatedAt: 201,
      }),
    ).resolves.toBe("duplicate");
    await expect(
      outbox.advanceRecoveryCheckpoint(scope, {
        ...checkpoint,
        committedSequence: 1,
      }),
    ).resolves.toBe("stale");
    await expect(
      outbox.advanceRecoveryCheckpoint(scope, {
        ...checkpoint,
        stateUpdate: Uint8Array.from([9]),
        payloadHash: "e".repeat(64),
      }),
    ).resolves.toBe("conflict");
    await expect(outbox.readRecoveryCheckpoint(scope)).resolves.toEqual({
      ...checkpoint,
      stateUpdate: Uint8Array.from([1, 2, 3]),
    });
  });
});
