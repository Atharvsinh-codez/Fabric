import { describe, expect, it } from "vitest";

import {
  getRealtimeIssuerEnvironment,
  getRealtimeRuntimeEnvironment,
} from "./env";

const baseEnvironment = {
  NODE_ENV: "test",
  FABRIC_ENV: "staging",
  APP_URL: "https://staging.fabric.example",
  REALTIME_ALLOWED_ORIGINS: "https://staging.fabric.example",
  REALTIME_DATABASE_URL:
    "postgresql://fabric_realtime:secret@example-pooler.neon.tech/fabric?sslmode=require",
  REALTIME_TICKET_SIGNING_KEY:
    "signing-key-that-is-longer-than-thirty-two-characters",
  REALTIME_TICKET_REDEMPTION_KEY:
    "redemption-key-that-is-longer-than-thirty-two-characters",
} as const;

describe("realtime runtime environment", () => {
  it("accepts staging and requires the purpose-specific database credential", () => {
    const environment = getRealtimeRuntimeEnvironment(baseEnvironment);
    expect(environment.databaseUrl).toBe(baseEnvironment.REALTIME_DATABASE_URL);
    expect(environment.allowedOrigins.has(baseEnvironment.APP_URL)).toBe(true);
  });

  it("does not fall back to the shared web DATABASE_URL", () => {
    expect(() =>
      getRealtimeRuntimeEnvironment({
        ...baseEnvironment,
        REALTIME_DATABASE_URL: undefined,
        DATABASE_URL: baseEnvironment.REALTIME_DATABASE_URL,
      }),
    ).toThrow();
  });

  it("rejects reuse of the ticket signing key as the redemption key", () => {
    expect(() =>
      getRealtimeRuntimeEnvironment({
        ...baseEnvironment,
        REALTIME_TICKET_REDEMPTION_KEY:
          baseEnvironment.REALTIME_TICKET_SIGNING_KEY,
      }),
    ).toThrow("purpose-separated");
  });
});

describe("realtime issuer environment", () => {
  it("uses only the canonical app origin in production when deployment URLs are stale", () => {
    const environment = getRealtimeIssuerEnvironment({
      ...baseEnvironment,
      FABRIC_ENV: "production",
      APP_URL: "https://old.fabric.example",
      REALTIME_ALLOWED_ORIGINS: "https://old.fabric.example",
    });

    expect([...environment.allowedOrigins]).toEqual([
      "https://fabric.athrix.me",
    ]);
    expect(environment.allowedOrigins.has("https://fabric.athrix.me/")).toBe(
      false,
    );
  });

  it("preserves configured exact origins outside production", () => {
    const environment = getRealtimeIssuerEnvironment(baseEnvironment);

    expect([...environment.allowedOrigins]).toEqual([
      baseEnvironment.REALTIME_ALLOWED_ORIGINS,
    ]);
  });
});
