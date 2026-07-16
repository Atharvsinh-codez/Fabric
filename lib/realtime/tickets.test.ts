import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { REALTIME_PROTOCOL_VERSION } from "./constants";
import { mintRealtimeTicket, verifyRealtimeTicket } from "./tickets";

const configuration = {
  key: "realtime-signing-key-with-at-least-32-characters",
  issuer: "fabric-web-test",
  audience: "fabric-realtime-test",
};

const issuedAt = new Date("2026-07-13T12:00:00.123Z");

async function mintLegacyTicket(): Promise<string> {
  const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1_000);
  return new SignJWT({
    workspaceId: "22222222-2222-4222-8222-222222222222",
    boardId: "33333333-3333-4333-8333-333333333333",
    documentGenerationId: "44444444-4444-4444-8444-444444444444",
    capabilities: ["read"],
    protocolVersion: REALTIME_PROTOCOL_VERSION,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setIssuer(configuration.issuer)
    .setAudience(configuration.audience)
    .setJti("66666666-6666-4666-8666-666666666666")
    .setIssuedAt(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + 45)
    .sign(new TextEncoder().encode(configuration.key));
}

describe("realtime tickets", () => {
  it("round-trips a board and generation scoped 45-second ticket", async () => {
    const minted = await mintRealtimeTicket(
      {
        subject: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        boardId: "33333333-3333-4333-8333-333333333333",
        documentGenerationId: "44444444-4444-4444-8444-444444444444",
        displayLabel: "  Ada\n\u202eLovelace  ",
        capabilities: ["read", "write", "awareness"],
        jti: "55555555-5555-4555-8555-555555555555",
        now: issuedAt,
      },
      configuration,
    );

    const verified = await verifyRealtimeTicket(minted.ticket, {
      ...configuration,
      now: new Date(issuedAt.getTime() + 10_000),
    });
    expect(verified).toEqual(minted.claims);
    expect(verified.displayLabel).toBe("Ada Lovelace");
    expect(verified.authorizationIssuedAtMs).toBe(issuedAt.getTime());
    expect(verified.exp - verified.iat).toBe(45);
  });

  it("accepts legacy signed tickets without the millisecond issuance claim", async () => {
    const verified = await verifyRealtimeTicket(await mintLegacyTicket(), {
      ...configuration,
      now: new Date(issuedAt.getTime() + 10_000),
    });

    expect(verified.authorizationIssuedAtMs).toBeUndefined();
    expect(verified.displayLabel).toBeUndefined();
    expect(verified.iat).toBe(Math.floor(issuedAt.getTime() / 1_000));
  });

  it("rejects an expired ticket and an audience mismatch without exposing claims", async () => {
    const minted = await mintRealtimeTicket(
      {
        subject: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        boardId: "33333333-3333-4333-8333-333333333333",
        documentGenerationId: "44444444-4444-4444-8444-444444444444",
        capabilities: ["read"],
        now: issuedAt,
      },
      configuration,
    );

    await expect(
      verifyRealtimeTicket(minted.ticket, {
        ...configuration,
        now: new Date(issuedAt.getTime() + 70_000),
      }),
    ).rejects.toMatchObject({ code: "expired" });
    await expect(
      verifyRealtimeTicket(minted.ticket, {
        ...configuration,
        audience: "another-runtime",
        now: issuedAt,
      }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("enforces the locked 30 to 60 second lifetime", async () => {
    await expect(
      mintRealtimeTicket(
        {
          subject: "11111111-1111-4111-8111-111111111111",
          workspaceId: "22222222-2222-4222-8222-222222222222",
          boardId: "33333333-3333-4333-8333-333333333333",
          documentGenerationId: "44444444-4444-4444-8444-444444444444",
          capabilities: ["read"],
          lifetimeSeconds: 61,
        },
        configuration,
      ),
    ).rejects.toThrow("between 30 and 60 seconds");
  });
});
