import { SITE_URL } from "@/lib/site";

const PRODUCTION_ORIGIN_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "APP_URL",
  "AUTH_URL",
  "NEXTAUTH_URL",
] as const;

export function installCanonicalAuthOrigin(
  environment: Record<string, string | undefined>,
): Record<string, string | undefined> {
  if (environment.FABRIC_ENV !== "production") {
    return { ...environment };
  }

  const canonicalEnvironment = { ...environment };
  for (const key of PRODUCTION_ORIGIN_KEYS) {
    canonicalEnvironment[key] = SITE_URL.origin;
    environment[key] = SITE_URL.origin;
  }

  return canonicalEnvironment;
}
