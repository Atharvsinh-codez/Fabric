import { describe, expect, it } from "vitest";

import {
  FABRIC_AI_PROVIDER,
  MAX_AI_API_KEYS,
  parseAiApiKeys,
  parseAiRunProvenance,
  parseAiRuntimeConfig,
} from "./config";

describe("parseAiRuntimeConfig", () => {
  const validConfig = {
    provider: FABRIC_AI_PROVIDER,
    baseUrl: "https://provider.example.test/v1/",
    apiKeys: ["sk-valid-server-key-with-enough-entropy"],
    model: "gcli/grok-4.5-medium",
    streamOnly: true,
    requestTimeoutMs: 45_000,
  } as const;

  it("accepts a bounded HTTPS OpenAI-compatible configuration", () => {
    expect(parseAiRuntimeConfig(validConfig)).toEqual({
      ...validConfig,
      baseUrl: "https://provider.example.test/v1",
    });
    expect(Object.isFrozen(parseAiRuntimeConfig(validConfig).apiKeys)).toBe(true);
  });

  it("rejects unsafe endpoints, unsupported providers, and malformed models", () => {
    expect(() => parseAiRuntimeConfig({ ...validConfig, baseUrl: "http://provider.test/v1" })).toThrow();
    expect(() => parseAiRuntimeConfig({
      ...validConfig,
      baseUrl: "https://user:password@provider.test/v1",
    })).toThrow();
    expect(() => parseAiRuntimeConfig({ ...validConfig, provider: "other" })).toThrow();
    expect(() => parseAiRuntimeConfig({ ...validConfig, model: "model with spaces" })).toThrow();
    expect(() => parseAiRuntimeConfig({ ...validConfig, streamOnly: false })).toThrow();
  });

  it("parses the same provider/model provenance persisted by the web runtime", () => {
    expect(parseAiRunProvenance({
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
    })).toEqual({
      provider: "openai-compatible",
      model: "gcli/grok-4.5-medium",
    });
  });
});

describe("parseAiApiKeys", () => {
  const primary = "sk-primary-server-key-with-enough-entropy";
  const secondary = "sk-secondary-server-key-with-enough-entropy";

  it("prefers, trims, and deduplicates the multi-key variable", () => {
    expect(parseAiApiKeys({
      AI_API_KEYS: ` ${primary},\n${secondary},${primary} `,
      AI_API_KEY: "sk-fallback-key-that-must-not-be-selected",
    })).toEqual([primary, secondary]);
  });

  it("accepts JSON arrays and a single-key fallback", () => {
    expect(parseAiApiKeys({ AI_API_KEYS: JSON.stringify([primary, secondary]) })).toEqual([
      primary,
      secondary,
    ]);
    expect(parseAiApiKeys({ AI_API_KEY: primary })).toEqual([primary]);
  });

  it("rejects malformed, placeholder, absent, and oversized lists without echoing keys", () => {
    const rejected = "replace-this-sensitive-provider-credential";
    for (const environment of [
      {},
      { AI_API_KEYS: "[not-json" },
      { AI_API_KEYS: rejected },
      {
        AI_API_KEYS: JSON.stringify(Array.from(
          { length: MAX_AI_API_KEYS + 1 },
          (_, index) => `sk-valid-key-${index.toString().padStart(2, "0")}-with-enough-entropy`,
        )),
      },
    ]) {
      let thrown: unknown;
      try {
        parseAiApiKeys(environment);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/AI_API_KEYS/);
      expect((thrown as Error).message).not.toContain(rejected);
    }
  });

  it("does not silently use the fallback when the preferred list is malformed", () => {
    expect(() => parseAiApiKeys({
      AI_API_KEYS: "   ",
      AI_API_KEY: primary,
    })).toThrow(/AI_API_KEYS/);
  });
});
