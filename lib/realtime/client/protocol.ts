import { z } from "zod";

import {
  REALTIME_CAPABILITIES,
  REALTIME_LIMITS,
  REALTIME_PROTOCOL_VERSION,
} from "../constants";

const uuid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const encodedUpdate = z
  .string()
  .min(4)
  .max(Math.ceil((REALTIME_LIMITS.maximumUpdateBytes * 4) / 3) + 4);
const encodedAwareness = z
  .string()
  .min(4)
  .max(Math.ceil((REALTIME_LIMITS.awarenessBytes * 4) / 3) + 4);
const encodedSnapshot = z
  .string()
  .min(4)
  .max(Math.ceil((REALTIME_LIMITS.snapshotBytes * 4) / 3) + 4);

const identity = {
  protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
  messageId: uuid,
  boardId: uuid,
  documentGenerationId: uuid,
  clientInstanceId: uuid,
};

const errorCode = z.enum([
  "authentication_failed",
  "authentication_timeout",
  "generation_mismatch",
  "idempotency_conflict",
  "internal_error",
  "invalid_awareness",
  "invalid_envelope",
  "invalid_update",
  "payload_too_large",
  "permission_denied",
  "rate_limited",
  "room_unavailable",
  "slow_consumer",
  "ticket_replayed",
]);

const authOkSchema = z
  .object({
    ...identity,
    type: z.literal("auth.ok"),
    payload: z
      .object({
        capabilities: z.array(z.enum(REALTIME_CAPABILITIES)).min(1).max(3),
        sequence: z.number().int().nonnegative(),
        stateUpdate: encodedSnapshot,
        awarenessStateUpdate: encodedSnapshot.nullable(),
        limits: z
          .object({
            frameBytes: z.number().int().positive().max(REALTIME_LIMITS.frameBytes),
            updateBytes: z
              .number()
              .int()
              .positive()
              .max(REALTIME_LIMITS.maximumUpdateBytes),
            awarenessBytes: z.number().int().positive().max(REALTIME_LIMITS.awarenessBytes),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

const authRefreshedSchema = z
  .object({
    ...identity,
    type: z.literal("auth.refreshed"),
    payload: z
      .object({
        capabilities: z.array(z.enum(REALTIME_CAPABILITIES)).min(1).max(3),
        expiresAt: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();

const syncUpdateSchema = z
  .object({
    ...identity,
    type: z.literal("sync.update"),
    payload: z
      .object({
        update: encodedUpdate,
        sequence: z.number().int().positive(),
        payloadHash: hash,
      })
      .strict(),
  })
  .strict();

const syncAckSchema = z
  .object({
    ...identity,
    type: z.literal("sync.ack"),
    payload: z
      .object({
        sequence: z.number().int().positive(),
        duplicate: z.boolean(),
        payloadHash: hash,
      })
      .strict(),
  })
  .strict();

const awarenessUpdateSchema = z
  .object({
    ...identity,
    type: z.literal("awareness.update"),
    payload: z.object({ update: encodedAwareness }).strict(),
  })
  .strict();

const errorSchema = z
  .object({
    ...identity,
    type: z.literal("error"),
    payload: z.object({ code: errorCode }).strict(),
  })
  .strict();

const pongSchema = z
  .object({
    ...identity,
    type: z.literal("pong"),
    payload: z.object({ nonce: z.string().min(1).max(128) }).strict(),
  })
  .strict();

export const realtimeServerEnvelopeSchema = z.discriminatedUnion("type", [
  authOkSchema,
  authRefreshedSchema,
  syncUpdateSchema,
  syncAckSchema,
  awarenessUpdateSchema,
  errorSchema,
  pongSchema,
]);

export type ValidatedServerEnvelope = z.infer<typeof realtimeServerEnvelopeSchema>;

export function parseServerEnvelope(raw: string): ValidatedServerEnvelope {
  if (new TextEncoder().encode(raw).byteLength > REALTIME_LIMITS.frameBytes) {
    throw new RangeError("The realtime server frame is too large.");
  }
  return realtimeServerEnvelopeSchema.parse(JSON.parse(raw) as unknown);
}

export function serializeAuthFrame(input: {
  messageId: string;
  clientInstanceId: string;
  ticket: string;
}): string {
  return JSON.stringify({
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    type: "auth",
    messageId: input.messageId,
    clientInstanceId: input.clientInstanceId,
    payload: { ticket: input.ticket },
  });
}

export function serializeAuthRefreshFrame(input: {
  messageId: string;
  clientInstanceId: string;
  boardId: string;
  documentGenerationId: string;
  ticket: string;
}): string {
  return JSON.stringify({
    protocolVersion: REALTIME_PROTOCOL_VERSION,
    type: "auth.refresh",
    messageId: input.messageId,
    clientInstanceId: input.clientInstanceId,
    boardId: input.boardId,
    documentGenerationId: input.documentGenerationId,
    payload: { ticket: input.ticket },
  });
}
