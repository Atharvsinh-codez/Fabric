import { afterEach, describe, expect, it, vi } from "vitest";

import { getSafeAuthErrorCode, safeAuthLogger } from "./safe-logger";

afterEach(() => {
  vi.restoreAllMocks();
});

function serializedConsoleCalls(spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .flatMap((call) => call)
    .map((value) => String(value))
    .join(" ");
}

describe("safeAuthLogger", () => {
  it("logs only an allowlisted Auth.js error type", () => {
    const sessionToken = "raw-session-token-must-never-be-logged";
    const sqlCause = Object.assign(new Error(`CONNECT_TIMEOUT ${sessionToken}`), {
      params: [sessionToken],
    });
    const authError = Object.assign(new Error(`Session lookup failed for ${sessionToken}`), {
      name: `Leaky${sessionToken}`,
      type: "SessionTokenError",
      cause: {
        err: sqlCause,
        params: [sessionToken],
        userContent: sessionToken,
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    safeAuthLogger.error(authError);

    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledWith("[auth][error] SessionTokenError");
    const emitted = serializedConsoleCalls([errorSpy, warnSpy, logSpy]);
    expect(emitted).not.toContain(sessionToken);
    expect(emitted).not.toContain("CONNECT_TIMEOUT");
    expect(emitted).not.toContain("params");
  });

  it("does not trust an arbitrary error name as a log code", () => {
    const secret = "secret-disguised-as-an-error-name";
    const error = new Error(secret);
    error.name = secret;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    safeAuthLogger.error(error);

    expect(getSafeAuthErrorCode(error)).toBe("UnknownError");
    expect(errorSpy).toHaveBeenCalledWith("[auth][error] UnknownError");
    expect(serializedConsoleCalls([errorSpy])).not.toContain(secret);
  });

  it("drops debug metadata and bounds unknown warning codes", () => {
    const secret = "cookie-or-provider-secret";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    safeAuthLogger.debug("request", { cookie: secret, params: [secret] });
    safeAuthLogger.warn(secret);

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[auth][warn] UnknownWarning");
    expect(serializedConsoleCalls([errorSpy, warnSpy, logSpy])).not.toContain(secret);
  });
});
