import { describe, expect, it } from "vitest";

import { parseAuthEnvironment } from "./environment-policy";

const productionEnvironment = {
  NODE_ENV: "production",
  FABRIC_ENV: "production",
  NEXT_PUBLIC_APP_URL: "https://app.fabric.example",
  APP_URL: "https://app.fabric.example",
  AUTH_URL: "https://app.fabric.example",
  AUTH_SECRET: "a-secure-random-auth-secret-with-32-chars",
  AUTH_GOOGLE_ID: "123456789-fabric.apps.googleusercontent.com",
  AUTH_GOOGLE_SECRET: "google-production-secret",
  AUTH_GITHUB_ID: "Iv1.fabricproductionid",
  AUTH_GITHUB_SECRET: "0123456789abcdef0123456789abcdef01234567",
  DATABASE_URL:
    "postgresql://fabric_web@ep-fabric-pooler.example.neon.tech/fabric?sslmode=require",
} as const;

describe("parseAuthEnvironment", () => {
  it("accepts a consistent production OAuth origin and pooled Neon URL", () => {
    const environment = parseAuthEnvironment(productionEnvironment);

    expect(environment.AUTH_URL).toBe(productionEnvironment.AUTH_URL);
    expect(environment.AUTH_TRUST_HOST).toBe(false);
  });

  it.each([
    { AUTH_URL: "http://app.fabric.example" },
    { AUTH_URL: "https://auth.fabric.example" },
    { APP_URL: "https://localhost" },
    { NEXT_PUBLIC_APP_URL: undefined },
  ])("rejects an unsafe or inconsistent production origin: %o", (override) => {
    expect(() =>
      parseAuthEnvironment({ ...productionEnvironment, ...override }),
    ).toThrow();
  });

  it("rejects placeholder auth credentials in production", () => {
    expect(() =>
      parseAuthEnvironment({
        ...productionEnvironment,
        AUTH_GITHUB_SECRET: "replace-me",
      }),
    ).toThrow();
  });

  it("allows local HTTP origins while still requiring complete credentials", () => {
    const environment = parseAuthEnvironment({
      ...productionEnvironment,
      NODE_ENV: "development",
      FABRIC_ENV: "local",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      APP_URL: "http://localhost:3000",
      AUTH_URL: "http://localhost:3000",
      AUTH_TRUST_HOST: "true",
    });

    expect(environment.AUTH_TRUST_HOST).toBe(true);
  });
});
