import { describe, expect, it } from "vitest";

import { REALTIME_LIMITS } from "../constants";
import { bytesToBase64 } from "./encoding";
import {
  parseServerEnvelope,
  serializeAuthFrame,
  serializeAuthRefreshFrame,
} from "./protocol";

const identity = {
  protocolVersion: 1,
  messageId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  documentGenerationId: "33333333-3333-4333-8333-333333333333",
  clientInstanceId: "44444444-4444-4444-8444-444444444444",
};

describe("browser realtime protocol", () => {
  it("validates strict typed server envelopes", () => {
    const parsed = parseServerEnvelope(
      JSON.stringify({
        ...identity,
        type: "sync.ack",
        payload: { sequence: 42, duplicate: false, payloadHash: "a".repeat(64) },
      }),
    );
    expect(parsed.type).toBe("sync.ack");

    expect(() =>
      parseServerEnvelope(
        JSON.stringify({
          ...identity,
          type: "sync.ack",
          payload: {
            sequence: 42,
            duplicate: false,
            payloadHash: "a".repeat(64),
            rawDatabaseError: "secret",
          },
        }),
      ),
    ).toThrow();
  });

  it("puts a ticket only in the fixed first auth frame", () => {
    const frame = JSON.parse(
      serializeAuthFrame({
        messageId: identity.messageId,
        clientInstanceId: identity.clientInstanceId,
        ticket: "t".repeat(64),
      }),
    ) as Record<string, unknown>;

    expect(frame).toEqual({
      protocolVersion: 1,
      type: "auth",
      messageId: identity.messageId,
      clientInstanceId: identity.clientInstanceId,
      payload: { ticket: "t".repeat(64) },
    });
  });

  it("uses a scoped in-band frame for a silent lease refresh", () => {
    const frame = JSON.parse(
      serializeAuthRefreshFrame({
        messageId: identity.messageId,
        clientInstanceId: identity.clientInstanceId,
        boardId: identity.boardId,
        documentGenerationId: identity.documentGenerationId,
        ticket: "t".repeat(64),
      }),
    );
    expect(frame).toMatchObject({
      type: "auth.refresh",
      boardId: identity.boardId,
      documentGenerationId: identity.documentGenerationId,
      payload: { ticket: "t".repeat(64) },
    });
    expect(
      parseServerEnvelope(
        JSON.stringify({
          ...identity,
          type: "auth.refreshed",
          payload: { capabilities: ["read"], expiresAt: Date.now() + 30_000 },
        }),
      ).type,
    ).toBe("auth.refreshed");
  });

  it("accepts a bounded update frame larger than the former 384 KiB cap", () => {
    const update = new Uint8Array(750 * 1024);
    update.fill(7);
    const parsed = parseServerEnvelope(
      JSON.stringify({
        ...identity,
        type: "sync.update",
        payload: {
          update: bytesToBase64(update),
          sequence: 1,
          payloadHash: "a".repeat(64),
        },
      }),
    );
    expect(parsed.type).toBe("sync.update");
    expect(update.byteLength).toBeLessThanOrEqual(
      REALTIME_LIMITS.maximumUpdateBytes,
    );
  });

  it("keeps every accepted awareness payload small enough for hibernation replay", () => {
    const maximumEncodedAwarenessBytes =
      Math.ceil((REALTIME_LIMITS.awarenessBytes * 4) / 3) + 4;

    expect(maximumEncodedAwarenessBytes).toBeLessThan(12 * 1024);
  });
});
