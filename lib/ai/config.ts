import { z } from "zod";

export const APPROVED_GEMINI_MODEL = "gemini-2.5-flash" as const;
export const FABRIC_GEMINI_MODELS = [
  "gemini-3.5-flash",
  APPROVED_GEMINI_MODEL,
] as const;
export type FabricGeminiModel = (typeof FABRIC_GEMINI_MODELS)[number];
export const FABRIC_AI_PROTOCOL_VERSION = 1 as const;
export const MAX_GEMINI_API_KEYS = 16 as const;

const placeholderPattern = /^(?:replace|change|your[-_ ]|example|test|dummy|placeholder|todo|undefined|null)/i;

const GeminiApiKeySchema = z
  .string()
  .trim()
  .min(20, "Gemini API key is missing or too short")
  .max(512, "Gemini API key is unexpectedly long")
  .refine((value) => !placeholderPattern.test(value), "Gemini API key is a placeholder");

const GeminiApiKeysSchema = z
  .array(GeminiApiKeySchema)
  .min(1, "At least one Gemini API key is required")
  .max(MAX_GEMINI_API_KEYS, `At most ${MAX_GEMINI_API_KEYS} Gemini API keys are allowed`);

const AiRuntimeConfigSchema = z
  .object({
    apiKeys: GeminiApiKeysSchema,
    model: z.literal(APPROVED_GEMINI_MODEL),
    storeInteractions: z.literal(false),
    requestTimeoutMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

type ParsedAiRuntimeConfig = z.infer<typeof AiRuntimeConfigSchema>;

export type AiRuntimeConfig = Readonly<
  Omit<ParsedAiRuntimeConfig, "apiKeys"> & { apiKeys: readonly string[] }
>;

type GeminiKeyEnvironment = Readonly<{
  GEMINI_API_KEYS?: string;
  GEMINI_API_KEY?: string;
}>;

function parseConfiguredKeyList(raw: string): unknown[] {
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch {
      throw new Error(
        "GEMINI_API_KEYS must be a JSON array or a comma/newline-separated list",
      );
    }
  }

  return raw
    .split(/[,\r\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Reads only server-side environment values. GEMINI_API_KEYS is preferred when
 * present; GEMINI_API_KEY remains a single-key compatibility fallback. Errors
 * deliberately identify only the variable contract and never include a key.
 */
export function parseGeminiApiKeys(environment: GeminiKeyEnvironment): readonly string[] {
  const hasConfiguredList = environment.GEMINI_API_KEYS !== undefined;
  const configuredList = environment.GEMINI_API_KEYS?.trim() ?? "";
  const legacyKey = environment.GEMINI_API_KEY?.trim();
  const candidates = hasConfiguredList
    ? parseConfiguredKeyList(configuredList)
    : legacyKey
      ? [legacyKey]
      : [];
  const parsed = GeminiApiKeysSchema.safeParse(candidates);
  if (!parsed.success) {
    throw new Error(
      `GEMINI_API_KEYS (or legacy GEMINI_API_KEY) must contain 1-${MAX_GEMINI_API_KEYS} valid keys`,
    );
  }
  return Object.freeze([...new Set(parsed.data)]);
}

/**
 * Validates injected values without reading process.env. This keeps environment
 * access at the runtime composition boundary and makes model/storage policy
 * impossible for a browser request to override.
 */
export function parseAiRuntimeConfig(input: unknown): AiRuntimeConfig {
  const parsed = AiRuntimeConfigSchema.parse(input);
  return Object.freeze({
    ...parsed,
    apiKeys: Object.freeze([...new Set(parsed.apiKeys)]),
  });
}
