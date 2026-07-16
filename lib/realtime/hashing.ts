import { createHash, createHmac } from "node:crypto";

export function hashRealtimePayload(payload: Uint8Array): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function hmacTicketIdentifier(jti: string, redemptionKey: string): string {
  return createHmac("sha256", redemptionKey).update(jti, "utf8").digest("hex");
}
