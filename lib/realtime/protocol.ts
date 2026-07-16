import { z } from "zod";

import { REALTIME_LIMITS, REALTIME_PROTOCOL_VERSION } from "./constants";

const uuid = z.string().uuid();
const encodedPayload = z
  .string()
  .min(4)
  .max(Math.ceil((REALTIME_LIMITS.maximumUpdateBytes * 4) / 3) + 4)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

export const realtimeAuthEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
    type: z.literal("auth"),
    messageId: uuid,
    clientInstanceId: uuid,
    payload: z.object({ ticket: z.string().min(64).max(4096) }).strict(),
  })
  .strict();

const envelopeIdentity = {
  protocolVersion: z.literal(REALTIME_PROTOCOL_VERSION),
  messageId: uuid,
  boardId: uuid,
  documentGenerationId: uuid,
  clientInstanceId: uuid,
};

const syncUpdateEnvelopeSchema = z
  .object({
    ...envelopeIdentity,
    type: z.literal("sync.update"),
    payload: z.object({ update: encodedPayload }).strict(),
  })
  .strict();

const awarenessUpdateEnvelopeSchema = z
  .object({
    ...envelopeIdentity,
    type: z.literal("awareness.update"),
    payload: z.object({ update: encodedPayload }).strict(),
  })
  .strict();

const pingEnvelopeSchema = z
  .object({
    ...envelopeIdentity,
    type: z.literal("ping"),
    payload: z.object({ nonce: z.string().min(1).max(128) }).strict(),
  })
  .strict();

const authRefreshEnvelopeSchema = z
  .object({
    ...envelopeIdentity,
    type: z.literal("auth.refresh"),
    payload: z.object({ ticket: z.string().min(64).max(4096) }).strict(),
  })
  .strict();

export const realtimeClientEnvelopeSchema = z.discriminatedUnion("type", [
  authRefreshEnvelopeSchema,
  syncUpdateEnvelopeSchema,
  awarenessUpdateEnvelopeSchema,
  pingEnvelopeSchema,
]);

export type RealtimeAuthEnvelope = z.infer<typeof realtimeAuthEnvelopeSchema>;
export type RealtimeClientEnvelope = z.infer<typeof realtimeClientEnvelopeSchema>;

export type RealtimeServerEnvelope = {
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  type:
    | "auth.ok"
    | "auth.refreshed"
    | "awareness.update"
    | "error"
    | "pong"
    | "sync.ack"
    | "sync.update";
  messageId: string;
  boardId: string;
  documentGenerationId: string;
  clientInstanceId: string;
  payload: Record<string, unknown>;
};

export function parseAuthEnvelope(raw: string): RealtimeAuthEnvelope {
  return realtimeAuthEnvelopeSchema.parse(JSON.parse(raw) as unknown);
}

export function parseClientEnvelope(raw: string): RealtimeClientEnvelope {
  return realtimeClientEnvelopeSchema.parse(JSON.parse(raw) as unknown);
}

export function decodePayload(encoded: string, maximumBytes: number): Uint8Array {
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new RangeError("The decoded realtime payload is outside the allowed size.");
  }
  if (bytes.toString("base64") !== encoded) {
    throw new TypeError("The realtime payload is not canonical base64.");
  }
  return new Uint8Array(bytes);
}

export function encodePayload(payload: Uint8Array): string {
  return Buffer.from(payload).toString("base64");
}

export function serializeServerEnvelope(envelope: RealtimeServerEnvelope): string {
  return JSON.stringify(envelope);
}
