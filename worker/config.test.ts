import { describe, expect, it } from "vitest";

import { loadServerlessWorkerConfig, loadWorkerConfig } from "./config";

const baseEnvironment = {
  WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.test/fabric?sslmode=require",
  GEMINI_API_KEYS:
    "production-primary-api-key-value-long-enough,production-secondary-api-key-value-long-enough",
  GEMINI_MODEL: "gemini-2.5-flash",
  GEMINI_STORE_INTERACTIONS: "false",
  AI_RUNS_ENABLED: "true",
};

describe("worker configuration boundary", () => {
  it("accepts only the reviewed model and store:false", () => {
    expect(loadWorkerConfig(baseEnvironment).ai).toMatchObject({
      apiKeys: [
        "production-primary-api-key-value-long-enough",
        "production-secondary-api-key-value-long-enough",
      ],
      model: "gemini-2.5-flash",
      storeInteractions: false,
    });
    expect(() => loadWorkerConfig({ ...baseEnvironment, GEMINI_MODEL: "gemini-flash-latest" })).toThrow();
    expect(() =>
      loadWorkerConfig({ ...baseEnvironment, GEMINI_STORE_INTERACTIONS: "true" }),
    ).toThrow();
  });

  it("supports the legacy single-key variable without weakening preferred-list validation", () => {
    expect(loadWorkerConfig({
      ...baseEnvironment,
      GEMINI_API_KEYS: undefined,
      GEMINI_API_KEY: "legacy-production-api-key-value-long-enough",
    }).ai.apiKeys).toEqual(["legacy-production-api-key-value-long-enough"]);

    expect(() => loadWorkerConfig({
      ...baseEnvironment,
      GEMINI_API_KEYS: "[malformed",
      GEMINI_API_KEY: "legacy-production-api-key-value-long-enough",
    })).toThrow(/GEMINI_API_KEYS/);
  });

  it("rejects reuse of the web database credential", () => {
    expect(() =>
      loadWorkerConfig({ ...baseEnvironment, DATABASE_URL: baseEnvironment.WORKER_DATABASE_URL }),
    ).toThrow(/distinct least-privilege worker credential/);
    expect(() =>
      loadWorkerConfig({
        ...baseEnvironment,
        DATABASE_URL: `  ${baseEnvironment.WORKER_DATABASE_URL}  `,
      }),
    ).toThrow(/distinct least-privilege worker credential/);
  });

  it("uses the authorized web role only for bounded serverless dispatch", () => {
    const databaseUrl = "postgresql://web:secret@db.example.test/fabric?sslmode=require";
    const serverlessEnvironment = {
      ...baseEnvironment,
      WORKER_DATABASE_URL: undefined,
      DATABASE_URL: databaseUrl,
      VERCEL: "1",
    };
    expect(loadServerlessWorkerConfig(serverlessEnvironment).databaseUrl).toBe(databaseUrl);
    expect(() =>
      loadServerlessWorkerConfig({ ...serverlessEnvironment, VERCEL: "0" }),
    ).toThrow();
    expect(() =>
      loadServerlessWorkerConfig({
        ...serverlessEnvironment,
        WORKER_DATABASE_URL: undefined,
        DATABASE_URL: undefined,
      }),
    ).toThrow();
    expect(() => loadWorkerConfig(serverlessEnvironment)).toThrow();
  });

  it("does not configure a second HTTP listener", () => {
    expect(loadWorkerConfig({ ...baseEnvironment, WORKER_PORT: "8081" })).not.toHaveProperty(
      "port",
    );
  });
});
