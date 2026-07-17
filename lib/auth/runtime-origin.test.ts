import { describe, expect, it } from "vitest";

import { SITE_URL } from "@/lib/site";

import { installCanonicalAuthOrigin } from "./runtime-origin";

describe("installCanonicalAuthOrigin", () => {
  it("forces every production OAuth callback to the Fabric domain", () => {
    const environment = {
      FABRIC_ENV: "production",
      NEXT_PUBLIC_APP_URL: "https://fabric-s9rn.vercel.app",
      APP_URL: "https://fabric-s9rn.vercel.app",
      AUTH_URL: "https://fabric-s9rn.vercel.app",
      NEXTAUTH_URL: "https://fabric-s9rn.vercel.app",
    };

    const resolved = installCanonicalAuthOrigin(environment);

    expect(resolved).toMatchObject({
      NEXT_PUBLIC_APP_URL: SITE_URL.origin,
      APP_URL: SITE_URL.origin,
      AUTH_URL: SITE_URL.origin,
      NEXTAUTH_URL: SITE_URL.origin,
    });
    expect(environment.AUTH_URL).toBe(SITE_URL.origin);
    expect(environment.NEXTAUTH_URL).toBe(SITE_URL.origin);
  });

  it("keeps local OAuth callbacks unchanged", () => {
    const environment = {
      FABRIC_ENV: "local",
      AUTH_URL: "http://localhost:3000",
    };

    expect(installCanonicalAuthOrigin(environment)).toEqual(environment);
  });
});
