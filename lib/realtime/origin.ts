export function canonicalOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("Realtime origins must contain only a scheme, host, and optional port.");
  }
  return parsed.origin;
}

export function parseAllowedOrigins(value: string): ReadonlySet<string> {
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(canonicalOrigin);

  if (origins.length === 0) {
    throw new Error("At least one exact realtime Origin is required.");
  }

  return new Set(origins);
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  return typeof origin === "string" && allowedOrigins.has(origin);
}
