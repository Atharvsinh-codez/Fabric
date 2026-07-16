import type { AdapterAccount } from "next-auth/adapters";
import { describe, expect, it } from "vitest";

import {
  canonicalizeOAuthEmail,
  getVerifiedProviderEmail,
  hasVerifiedProviderEmail,
  parseOAuthProvider,
  redactIdentityOnlyTokens,
} from "./oauth-policy";

describe("OAuth policy", () => {
  it("allows only Fabric's configured identity providers", () => {
    expect(parseOAuthProvider("google")).toBe("google");
    expect(parseOAuthProvider("github")).toBe("github");
    expect(parseOAuthProvider("credentials")).toBeNull();
    expect(parseOAuthProvider("google\u0000github")).toBeNull();
    expect(parseOAuthProvider(null)).toBeNull();
  });

  it("requires a verified provider email for Google and GitHub", () => {
    expect(
      hasVerifiedProviderEmail("google", {
        email: "person@example.com",
        email_verified: true,
      }),
    ).toBe(true);
    expect(
      hasVerifiedProviderEmail("github", {
        email: "person@example.com",
        email_verified: false,
      }),
    ).toBe(false);
    expect(
      hasVerifiedProviderEmail("github", {
        email_verified: true,
      }),
    ).toBe(false);
  });

  it("canonicalizes only valid verified provider emails", () => {
    expect(canonicalizeOAuthEmail(" Person@Example.COM ")).toBe("person@example.com");
    expect(canonicalizeOAuthEmail("not-an-email")).toBeNull();
    expect(
      getVerifiedProviderEmail("github", {
        email: " Person@Example.COM ",
        email_verified: true,
      }),
    ).toBe("person@example.com");
    expect(
      getVerifiedProviderEmail("google", {
        email: "person@example.com",
        email_verified: false,
      }),
    ).toBeNull();
  });

  it("removes reusable provider tokens before adapter persistence", () => {
    const account: AdapterAccount = {
      provider: "github",
      providerAccountId: "123",
      type: "oauth",
      userId: "9ef1992f-c3ee-4cc4-bbc2-3d3f92262be8",
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      id_token: "identity-secret",
      scope: "read:user user:email",
    };

    const redacted = redactIdentityOnlyTokens(account);

    expect(redacted.access_token).toBeUndefined();
    expect(redacted.refresh_token).toBeUndefined();
    expect(redacted.id_token).toBeUndefined();
    expect(redacted.providerAccountId).toBe("123");
  });
});
