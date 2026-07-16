import { describe, expect, it } from "vitest";

import {
  isOAuthSignInUserAllowed,
  isVerifiedEmailAutoLinkAllowed,
} from "./account-access";

describe("isOAuthSignInUserAllowed", () => {
  it("allows a first-time provider user that has not been persisted yet", () => {
    expect(isOAuthSignInUserAllowed({})).toBe(true);
  });

  it("allows an active persisted user", () => {
    expect(
      isOAuthSignInUserAllowed({ emailVerified: null, suspendedAt: null }),
    ).toBe(true);
  });

  it("rejects a suspended persisted user", () => {
    expect(
      isOAuthSignInUserAllowed({
        emailVerified: null,
        suspendedAt: new Date("2026-07-14T00:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("fails closed when a persisted row is missing suspension policy data", () => {
    expect(isOAuthSignInUserAllowed({ emailVerified: null })).toBe(false);
  });
});

describe("verified email account linking", () => {
  const activeGoogleAccount = {
    email: "person@example.com",
    suspendedAt: null,
    providers: ["google"],
  } as const;

  it("allows either verified provider to join one active OAuth identity", () => {
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "github",
        verifiedEmail: "person@example.com",
        incomingEmail: "PERSON@example.com",
        candidates: [activeGoogleAccount],
      }),
    ).toBe(true);
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "google",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [{ ...activeGoogleAccount, providers: ["github"] }],
      }),
    ).toBe(true);
  });

  it("allows a first verified OAuth identity to create its Fabric account", () => {
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "google",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [],
      }),
    ).toBe(true);
  });

  it("rejects mismatches, suspended targets, ambiguous users, and non-OAuth targets", () => {
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "github",
        verifiedEmail: "other@example.com",
        incomingEmail: "person@example.com",
        candidates: [activeGoogleAccount],
      }),
    ).toBe(false);
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "github",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [{ ...activeGoogleAccount, suspendedAt: new Date() }],
      }),
    ).toBe(false);
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "github",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [activeGoogleAccount, activeGoogleAccount],
      }),
    ).toBe(false);
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "github",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [{ ...activeGoogleAccount, providers: [] }],
      }),
    ).toBe(false);
  });

  it("rejects a different subject from the same provider", () => {
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "google",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [activeGoogleAccount],
      }),
    ).toBe(false);
    expect(
      isVerifiedEmailAutoLinkAllowed({
        incomingProvider: "github",
        verifiedEmail: "person@example.com",
        incomingEmail: "person@example.com",
        candidates: [{ ...activeGoogleAccount, providers: ["github"] }],
      }),
    ).toBe(false);
  });
});
