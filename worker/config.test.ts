import { describe, expect, it } from "vitest";

import { loadServerlessWorkerConfig, loadWorkerConfig } from "./config";

const baseEnvironment = {
  WORKER_DATABASE_URL: "postgresql://worker:secret@db.example.test/fabric?sslmode=require",
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: "https://provider.example.test/v1",
  AI_API_KEYS:
    "production-primary-api-key-value-long-enough,production-secondary-api-key-value-long-enough",
  AI_MODEL: "gcli/grok-4.5-medium",
  AI_STREAM_ONLY: "true",
  AI_RUNS_ENABLED: "true",
};

describe("worker configuration boundary", () => {
  it("accepts an environment-selected OpenAI-compatible endpoint and model", () => {
    expect(loadWorkerConfig(baseEnvironment).ai).toMatchObject({
      provider: "openai-compatible",
      baseUrl: "https://provider.example.test/v1",
      apiKeys: [
        "production-primary-api-key-value-long-enough",
        "production-secondary-api-key-value-long-enough",
      ],
      model: "gcli/grok-4.5-medium",
      streamOnly: true,
    });
    expect(() => loadWorkerConfig({ ...baseEnvironment, AI_PROVIDER: "other" })).toThrow();
    expect(() => loadWorkerConfig({ ...baseEnvironment, AI_BASE_URL: "http://provider.test/v1" })).toThrow();
    expect(() => loadWorkerConfig({ ...baseEnvironment, AI_MODEL: "model with spaces" })).toThrow();
    expect(() => loadWorkerConfig({ ...baseEnvironment, AI_STREAM_ONLY: "false" })).toThrow();
  });

  it("supports the single-key fallback without weakening preferred-list validation", () => {
    expect(loadWorkerConfig({
      ...baseEnvironment,
      AI_API_KEYS: undefined,
      AI_API_KEY: "fallback-production-api-key-value-long-enough",
    }).ai.apiKeys).toEqual(["fallback-production-api-key-value-long-enough"]);

    expect(() => loadWorkerConfig({
      ...baseEnvironment,
      AI_API_KEYS: "[malformed",
      AI_API_KEY: "fallback-production-api-key-value-long-enough",
    })).toThrow(/AI_API_KEYS/);
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
