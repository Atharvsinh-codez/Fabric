import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deriveAiMediaSigningKey,
  issueAiMediaToken,
  verifyAiMediaToken,
  type AiMediaClaim,
} from "./media-token";

const signingKey = "ai-media-signing-key-with-at-least-32-characters";
const now = new Date("2026-07-16T12:00:00.000Z");
const selectionClaim = {
  kind: "selection-preview",
  runId: "11111111-1111-4111-8111-111111111111",
  boardId: "22222222-2222-4222-8222-222222222222",
} satisfies AiMediaClaim;
const assetClaim = {
  kind: "board-asset",
  runId: selectionClaim.runId,
  boardId: selectionClaim.boardId,
  assetId: "33333333-3333-4333-8333-333333333333",
  contentHash: "a".repeat(64),
} satisfies AiMediaClaim;

describe("AI media tokens", () => {
  it("derives deterministic purpose-separated JWT material from the existing auth secret", () => {
    expect(deriveAiMediaSigningKey("a".repeat(32))).toHaveLength(43);
    expect(deriveAiMediaSigningKey("a".repeat(32))).toBe(
      deriveAiMediaSigningKey("a".repeat(32)),
    );
    expect(deriveAiMediaSigningKey("a".repeat(32))).not.toBe(
      deriveAiMediaSigningKey("b".repeat(32)),
    );
    expect(deriveAiMediaSigningKey("a".repeat(32))).not.toContain("a".repeat(16));
  });

  it.each([selectionClaim, assetClaim])(
    "round-trips a short-lived $kind capability without adding unrelated authority",
    async (claim) => {
      const token = await issueAiMediaToken({ signingKey, claim, now });
      await expect(
        verifyAiMediaToken(token, {
          signingKey,
          now: new Date(now.getTime() + 60_000),
        }),
      ).resolves.toEqual(claim);
    },
  );

  it("rejects expiry and a different signing key", async () => {
    const token = await issueAiMediaToken({ signingKey, claim: assetClaim, now });

    await expect(
      verifyAiMediaToken(token, {
        signingKey,
        now: new Date(now.getTime() + 301_000),
      }),
    ).rejects.toMatchObject({ code: "invalid" });
    await expect(
      verifyAiMediaToken(token, {
        signingKey: "different-ai-media-key-with-at-least-32-characters",
        now,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("rejects an overlong lifetime even when the token is correctly signed", async () => {
    const issuedAt = Math.floor(now.getTime() / 1_000);
    const token = await new SignJWT(selectionClaim)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("fabric-web")
      .setAudience("fabric-ai-media")
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 600)
      .sign(new TextEncoder().encode(signingKey));

    await expect(
      verifyAiMediaToken(token, { signingKey, now }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("requires a dedicated HS256 key with at least 256 bits of UTF-8 material", async () => {
    await expect(
      issueAiMediaToken({ signingKey: "too-short", claim: selectionClaim, now }),
    ).rejects.toMatchObject({ code: "configuration" });
  });
});
