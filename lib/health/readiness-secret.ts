import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function hasValidReadinessSecret(
  authorizationHeader: string | null,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret || configuredSecret.length < 32 || !authorizationHeader) {
    return false;
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader);
  if (!match?.[1]) return false;

  return timingSafeEqual(digest(match[1]), digest(configuredSecret));
}
