const SAFE_AUTH_ERROR_CODES = new Set([
  "AccessDenied",
  "AccountNotLinked",
  "AdapterError",
  "CallbackRouteError",
  "CredentialsSignin",
  "DuplicateConditionalUI",
  "EmailSignInError",
  "ErrorPageLoop",
  "EventError",
  "ExperimentalFeatureNotEnabled",
  "InvalidCallbackUrl",
  "InvalidCheck",
  "InvalidEndpoints",
  "InvalidProvider",
  "JWTSessionError",
  "MissingAdapter",
  "MissingAdapterMethods",
  "MissingAuthorize",
  "MissingCSRF",
  "MissingSecret",
  "MissingWebAuthnAutocomplete",
  "OAuthAccountNotLinked",
  "OAuthCallbackError",
  "OAuthProfileParseError",
  "OAuthSignInError",
  "SessionTokenError",
  "SignOutError",
  "UnknownAction",
  "UnsupportedStrategy",
  "UntrustedHost",
  "Verification",
  "WebAuthnVerificationError",
]);

const SAFE_ERROR_NAMES = new Set([
  "AggregateError",
  "Error",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);

const SAFE_WARNING_CODES = new Set([
  "csrf-disabled",
  "debug-enabled",
  "env-url-basepath-mismatch",
  "env-url-basepath-redundant",
  "experimental-webauthn",
]);

function readStringProperty(value: object, property: string): string | null {
  try {
    const candidate = Reflect.get(value, property);
    return typeof candidate === "string" ? candidate : null;
  } catch {
    return null;
  }
}

export function getSafeAuthErrorCode(error: Error): string {
  const authType = readStringProperty(error, "type");
  if (authType && SAFE_AUTH_ERROR_CODES.has(authType)) return authType;

  const errorName = readStringProperty(error, "name");
  return errorName && SAFE_ERROR_NAMES.has(errorName) ? errorName : "UnknownError";
}

function getSafeWarningCode(code: string): string {
  return SAFE_WARNING_CODES.has(code) ? code : "UnknownWarning";
}

export const safeAuthLogger = Object.freeze({
  error(error: Error): void {
    console.error(`[auth][error] ${getSafeAuthErrorCode(error)}`);
  },
  warn(code: string): void {
    console.warn(`[auth][warn] ${getSafeWarningCode(code)}`);
  },
  debug(_message: string, _metadata?: unknown): void {
    // Auth.js debug metadata may contain cookies, provider responses, and SQL parameters.
    void _message;
    void _metadata;
  },
});
