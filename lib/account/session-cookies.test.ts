import { describe, expect, it } from "vitest";

import { getAuthSessionTokenCandidates } from "./session-cookies";

const standardToken = "standard-session-token-123456";
const secureToken = "secure-session-token-12345678";

describe("getAuthSessionTokenCandidates", () => {
  it("accepts only the cookie form matching the request protocol", () => {
    const cookies = [
      { name: "authjs.session-token", value: standardToken },
      { name: "__Secure-authjs.session-token", value: secureToken },
    ];

    expect(getAuthSessionTokenCandidates(cookies, true)).toEqual([secureToken]);
    expect(getAuthSessionTokenCandidates(cookies, false)).toEqual([standardToken]);
  });

  it("reassembles valid Auth.js cookie chunks in index order", () => {
    const cookies = [
      { name: "authjs.session-token.1", value: "token-1234567890" },
      { name: "authjs.session-token.0", value: "chunked-session-" },
    ];

    expect(getAuthSessionTokenCandidates(cookies, false)).toEqual([
      "chunked-session-token-1234567890",
    ]);
  });

  it("rejects ambiguous, incomplete, and unrelated cookies", () => {
    expect(
      getAuthSessionTokenCandidates(
        [
          { name: "authjs.session-token", value: standardToken },
          { name: "authjs.session-token.0", value: "duplicate-representation" },
        ],
        false,
      ),
    ).toEqual([]);

    expect(
      getAuthSessionTokenCandidates(
        [{ name: "authjs.session-token.1", value: "missing-first-chunk-123" }],
        false,
      ),
    ).toEqual([]);

    expect(
      getAuthSessionTokenCandidates(
        [{ name: "unrelated", value: "not-an-auth-session-token" }],
        false,
      ),
    ).toEqual([]);
  });
});
