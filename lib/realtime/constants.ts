export const REALTIME_PROTOCOL_VERSION = 1 as const;

export const REALTIME_CAPABILITIES = ["read", "write", "awareness"] as const;
export type RealtimeCapability = (typeof REALTIME_CAPABILITIES)[number];

export const REALTIME_LIMITS = {
  authDeadlineMs: 5_000,
  authFrameBytes: 8 * 1024,
  // A 4 MiB canonical update expands to roughly 5.34 MiB as base64. Keep a
  // bounded envelope allowance below Cloudflare's 32 MiB WebSocket ceiling.
  frameBytes: 6 * 1024 * 1024,
  maximumUpdateBytes: 4 * 1024 * 1024,
  // The attached PostgreSQL runtime retains its existing row-size contract.
  updateBytes: 256 * 1024,
  // Socket hibernation attachments are capped at 16 KiB. Keeping raw
  // awareness at 8 KiB leaves room for base64 expansion plus scoped metadata,
  // so every accepted presence state can be replayed to late joiners.
  awarenessBytes: 8 * 1024,
  snapshotBytes: 4 * 1024 * 1024,
  // One maximum-sized recovery frame must be allowed to drain before the
  // following presence/ACK frame is evaluated for slow-consumer pressure.
  bufferedAmountBytes: 8 * 1024 * 1024,
  awarenessIntervalMs: 100,
  permissionRecheckMs: 30_000,
  ticketLifetimeSeconds: 45,
  ticketMintsPerMinute: 12,
} as const;

export const REALTIME_CLOSE = {
  invalidEnvelope: { code: 4400, reason: "invalid_envelope" },
  authenticationFailed: { code: 4401, reason: "authentication_failed" },
  permissionDenied: { code: 4403, reason: "permission_denied" },
  authenticationTimeout: { code: 4408, reason: "authentication_timeout" },
  idempotencyConflict: { code: 4409, reason: "idempotency_conflict" },
  slowConsumer: { code: 4410, reason: "slow_consumer" },
  payloadTooLarge: { code: 4413, reason: "payload_too_large" },
  rateLimited: { code: 4429, reason: "rate_limited" },
  roomUnavailable: { code: 4450, reason: "room_unavailable" },
  internalError: { code: 4500, reason: "internal_error" },
} as const;

export type RealtimeErrorCode =
  | "authentication_failed"
  | "authentication_timeout"
  | "generation_mismatch"
  | "idempotency_conflict"
  | "internal_error"
  | "invalid_awareness"
  | "invalid_envelope"
  | "invalid_update"
  | "payload_too_large"
  | "permission_denied"
  | "rate_limited"
  | "room_unavailable"
  | "slow_consumer"
  | "ticket_replayed";
