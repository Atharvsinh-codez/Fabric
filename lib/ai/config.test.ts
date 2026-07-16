import { describe, expect, it } from "vitest";

import {
  APPROVED_GEMINI_MODEL,
  MAX_GEMINI_API_KEYS,
  parseAiRuntimeConfig,
  parseGeminiApiKeys,
} from "./config";

describe("parseAiRuntimeConfig", () => {
  const validConfig = {
    apiKeys: ["AQ.valid-server-key-with-enough-entropy"],
    model: APPROVED_GEMINI_MODEL,
    storeInteractions: false,
    requestTimeoutMs: 45_000,
  } as const;

  it("accepts only the reviewed model with provider storage disabled", () => {
    expect(parseAiRuntimeConfig(validConfig)).toEqual(validConfig);
    expect(Object.isFrozen(parseAiRuntimeConfig(validConfig).apiKeys)).toBe(true);
  });

  it("rejects aliases and provider-side storage", () => {
    expect(() => parseAiRuntimeConfig({ ...validConfig, model: "gemini-flash-latest" })).toThrow();
    expect(() => parseAiRuntimeConfig({ ...validConfig, storeInteractions: true })).toThrow();
  });

  it("rejects absent and placeholder keys", () => {
    expect(() => parseAiRuntimeConfig({ ...validConfig, apiKeys: undefined })).toThrow();
    expect(() =>
      parseAiRuntimeConfig({ ...validConfig, apiKeys: ["YOUR_GEMINI_API_KEY_REPLACE_ME"] }),
    ).toThrow();
  });
});

describe("parseGeminiApiKeys", () => {
  const primary = "AQ.primary-server-key-with-enough-entropy";
  const secondary = "AQ.secondary-server-key-with-enough-entropy";

  it("prefers, trims, and deduplicates the multi-key variable", () => {
    expect(parseGeminiApiKeys({
      GEMINI_API_KEYS: ` ${primary},\n${secondary},${primary} `,
      GEMINI_API_KEY: "AQ.legacy-key-that-must-not-be-selected",
    })).toEqual([primary, secondary]);
  });

  it("accepts a JSON array for hosting dashboards", () => {
    expect(parseGeminiApiKeys({
      GEMINI_API_KEYS: JSON.stringify([primary, secondary]),
    })).toEqual([primary, secondary]);
  });

  it("keeps the legacy single-key environment compatible", () => {
    expect(parseGeminiApiKeys({ GEMINI_API_KEY: primary })).toEqual([primary]);
  });

  it("rejects malformed, placeholder, absent, and oversized key lists without echoing values", () => {
    for (const environment of [
      {},
      { GEMINI_API_KEYS: "[not-json" },
      { GEMINI_API_KEYS: "replace-me" },
      { GEMINI_API_KEYS: JSON.stringify(Array.from(
        { length: MAX_GEMINI_API_KEYS + 1 },
        (_, index) => `AQ.valid-key-${index.toString().padStart(2, "0")}-with-enough-entropy`,
      )) },
    ]) {
      expect(() => parseGeminiApiKeys(environment)).toThrow(/GEMINI_API_KEYS/);
    }
  });

  it("does not silently fall back when the preferred variable is malformed", () => {
    for (const preferred of ["[malformed", "   "]) {
      expect(() => parseGeminiApiKeys({
        GEMINI_API_KEYS: preferred,
        GEMINI_API_KEY: primary,
      })).toThrow(/GEMINI_API_KEYS/);
    }
  });

  it("never includes rejected credential material in its error", () => {
    const rejected = "replace-this-sensitive-provider-credential";
    let thrown: unknown;
    try {
      parseGeminiApiKeys({ GEMINI_API_KEYS: rejected });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).not.toContain(rejected);
  });
});
