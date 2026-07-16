const DEFAULT_RETURN_PATH = "/app";
const APP_PATH_PATTERN = /^\/app(?:\/|$)/;
const PUBLIC_SHARE_PATH_PATTERN = /^\/share\/[A-Za-z0-9_-]{43}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function getSafeReturnPath(
  candidate: string | string[] | null | undefined,
  fallback = DEFAULT_RETURN_PATH,
): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2_048) {
    return fallback;
  }

  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://fabric.invalid");
    const decodedPathname = decodeURIComponent(parsed.pathname);
    const isAppDestination = APP_PATH_PATTERN.test(parsed.pathname);
    const isStrictPublicShareDestination =
      PUBLIC_SHARE_PATH_PATTERN.test(parsed.pathname) && candidate === parsed.pathname;

    if (
      parsed.origin !== "https://fabric.invalid" ||
      (!isAppDestination && !isStrictPublicShareDestination) ||
      decodedPathname.includes("\\") ||
      CONTROL_CHARACTER_PATTERN.test(decodedPathname)
    ) {
      return fallback;
    }

    return isStrictPublicShareDestination
      ? parsed.pathname
      : `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}
