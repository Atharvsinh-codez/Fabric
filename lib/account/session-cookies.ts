export type RequestCookie = Readonly<{
  name: string;
  value: string;
}>;

const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;

const MIN_SESSION_TOKEN_LENGTH = 16;
const MAX_SESSION_TOKEN_LENGTH = 8_192;

function isPlausibleSessionToken(value: string): boolean {
  return value.length >= MIN_SESSION_TOKEN_LENGTH && value.length <= MAX_SESSION_TOKEN_LENGTH;
}

function readCookieValue(cookies: readonly RequestCookie[], baseName: string): string | null {
  const exactCookies = cookies.filter((cookie) => cookie.name === baseName);
  const chunkPrefix = `${baseName}.`;
  const chunks = cookies
    .filter((cookie) => cookie.name.startsWith(chunkPrefix))
    .map((cookie) => ({
      index: Number(cookie.name.slice(chunkPrefix.length)),
      value: cookie.value,
    }));

  if (exactCookies.length > 1 || (exactCookies.length === 1 && chunks.length > 0)) {
    return null;
  }

  if (exactCookies.length === 1) {
    return isPlausibleSessionToken(exactCookies[0].value) ? exactCookies[0].value : null;
  }

  if (chunks.length === 0) return null;

  chunks.sort((left, right) => left.index - right.index);
  if (
    chunks.some(
      (chunk, index) =>
        !Number.isSafeInteger(chunk.index) || chunk.index !== index || chunk.value.length === 0,
    )
  ) {
    return null;
  }

  const value = chunks.map((chunk) => chunk.value).join("");
  return isPlausibleSessionToken(value) ? value : null;
}

export function getAuthSessionTokenCandidates(
  cookies: readonly RequestCookie[],
  preferSecureCookie: boolean,
): string[] {
  const cookieName = preferSecureCookie ? SESSION_COOKIE_NAMES[0] : SESSION_COOKIE_NAMES[1];
  const value = readCookieValue(cookies, cookieName);
  return value ? [value] : [];
}
