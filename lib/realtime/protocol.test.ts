import { describe, expect, it } from "vitest";

import { REALTIME_CLOSE, REALTIME_PROTOCOL_VERSION } from "./constants";
import { isAllowedOrigin, parseAllowedOrigins } from "./origin";
import {
  decodePayload,
  encodePayload,
  parseAuthEnvelope,
  parseClientEnvelope,
} from "./protocol";

const identity = {
  protocolVersion: REALTIME_PROTOCOL_VERSION,
  messageId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
  documentGenerationId: "33333333-3333-4333-8333-333333333333",
  clientInstanceId: "44444444-4444-4444-8444-444444444444",
};

describe("realtime protocol", () => {
  it("accepts the fixed first-message auth envelope and rejects extra fields", () => {
    const envelope = {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      type: "auth",
      messageId: identity.messageId,
      clientInstanceId: identity.clientInstanceId,
      payload: { ticket: "x".repeat(64) },
    };
    expect(parseAuthEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    expect(() => parseAuthEnvelope(JSON.stringify({ ...envelope, boardId: identity.boardId }))).toThrow();
  });

  it("validates a strict versioned update envelope", () => {
    const update = encodePayload(Uint8Array.of(1, 2, 3));
    const envelope = {
      ...identity,
      type: "sync.update",
      payload: { update },
    };
    expect(parseClientEnvelope(JSON.stringify(envelope))).toEqual(envelope);
    expect(() =>
      parseClientEnvelope(
        JSON.stringify({ ...envelope, protocolVersion: REALTIME_PROTOCOL_VERSION + 1 }),
      ),
    ).toThrow();
  });

  it("requires canonical base64 and enforces the decoded cap", () => {
    expect(decodePayload("AQID", 3)).toEqual(Uint8Array.of(1, 2, 3));
    expect(() => decodePayload("AQID", 2)).toThrow(RangeError);
    expect(() => decodePayload("AQID\n", 8)).toThrow(TypeError);
  });

  it("uses an exact Origin allowlist", () => {
    const allowed = parseAllowedOrigins("https://fabric.example,https://preview.fabric.example");
    expect(isAllowedOrigin("https://fabric.example", allowed)).toBe(true);
    expect(isAllowedOrigin("https://fabric.example.evil.test", allowed)).toBe(false);
    expect(isAllowedOrigin("https://fabric.example/", allowed)).toBe(false);
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
  });

  it("keeps application close codes and reasons safe for the WebSocket close frame", () => {
    for (const close of Object.values(REALTIME_CLOSE)) {
      expect(close.code).toBeGreaterThanOrEqual(4000);
      expect(close.code).toBeLessThan(5000);
      expect(Buffer.byteLength(close.reason)).toBeLessThanOrEqual(123);
      expect(close.reason).toMatch(/^[a-z_]+$/);
    }
  });
});
