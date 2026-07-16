import { describe, expect, it } from "vitest";

import { hasValidReadinessSecret } from "./readiness-secret";

const secret = "a-production-health-secret-with-32-chars";

describe("hasValidReadinessSecret", () => {
  it("accepts an exact bearer secret", () => {
    expect(hasValidReadinessSecret(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([
    null,
    "",
    "Basic credentials",
    "Bearer wrong-secret",
    "Bearer",
  ])("rejects an invalid authorization header", (authorizationHeader) => {
    expect(hasValidReadinessSecret(authorizationHeader, secret)).toBe(false);
  });

  it("rejects missing or weak server configuration", () => {
    expect(hasValidReadinessSecret(`Bearer ${secret}`, undefined)).toBe(false);
    expect(hasValidReadinessSecret("Bearer short", "short")).toBe(false);
  });
});
