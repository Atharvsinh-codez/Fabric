import { z } from "zod";

export const FABRIC_AI_PROVIDER = "openai-compatible" as const;
export const FABRIC_AI_PROTOCOL_VERSION = 1 as const;
export const MAX_AI_API_KEYS = 16 as const;

const placeholderPattern =
  /^(?:replace|change|your[-_ ]|example|test|dummy|placeholder|todo|undefined|null)/i;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;

const AiProviderSchema = z.literal(FABRIC_AI_PROVIDER);

const AiModelSchema = z
  .string()
  .trim()
  .min(1, "AI model is required")
  .max(255, "AI model is unexpectedly long")
  .regex(modelPattern, "AI model contains unsupported characters")
  .refine((value) => !placeholderPattern.test(value), "AI model is a placeholder");

const AiBaseUrlSchema = z
  .string()
  .trim()
  .url("AI base URL must be a valid URL")
  .transform((value, context) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: "custom",
        message: "AI base URL must be a credential-free HTTPS URL",
      });
      return z.NEVER;
    }
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  });

const AiApiKeySchema = z
  .string()
  .trim()
  .min(16, "AI API key is missing or too short")
  .max(512, "AI API key is unexpectedly long")
  .refine((value) => !placeholderPattern.test(value), "AI API key is a placeholder");

const AiApiKeysSchema = z
  .array(AiApiKeySchema)
  .min(1, "At least one AI API key is required")
  .max(MAX_AI_API_KEYS, `At most ${MAX_AI_API_KEYS} AI API keys are allowed`);

const AiRuntimeConfigSchema = z
  .object({
    provider: AiProviderSchema,
    baseUrl: AiBaseUrlSchema,
    apiKeys: AiApiKeysSchema,
    model: AiModelSchema,
    streamOnly: z.literal(true),
    requestTimeoutMs: z.number().int().min(1_000).max(300_000),
  })
  .strict();

type ParsedAiRuntimeConfig = z.infer<typeof AiRuntimeConfigSchema>;

export type FabricAiProvider = typeof FABRIC_AI_PROVIDER;
export type FabricAiModel = string;
export type AiRuntimeConfig = Readonly<
  Omit<ParsedAiRuntimeConfig, "apiKeys"> & { apiKeys: readonly string[] }
>;

type AiKeyEnvironment = Readonly<{
  AI_API_KEYS?: string;
  AI_API_KEY?: string;
}>;

export type AiRunProvenance = Readonly<{
  provider: FabricAiProvider;
  model: FabricAiModel;
}>;

function parseConfiguredKeyList(raw: string): unknown[] {
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch {
      throw new Error(
        "AI_API_KEYS must be a JSON array or a comma/newline-separated list",
      );
    }
  }

  return raw
    .split(/[,\r\n]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Reads only server-side environment values. AI_API_KEYS is preferred when
 * present; AI_API_KEY is the single-key fallback. Errors deliberately identify
 * only the variable contract and never include credential material.
 */
export function parseAiApiKeys(environment: AiKeyEnvironment): readonly string[] {
  const hasConfiguredList = environment.AI_API_KEYS !== undefined;
  const configuredList = environment.AI_API_KEYS?.trim() ?? "";
  const fallbackKey = environment.AI_API_KEY?.trim();
  const candidates = hasConfiguredList
    ? parseConfiguredKeyList(configuredList)
    : fallbackKey
      ? [fallbackKey]
      : [];
  const parsed = AiApiKeysSchema.safeParse(candidates);
  if (!parsed.success) {
    throw new Error(
      `AI_API_KEYS (or AI_API_KEY) must contain 1-${MAX_AI_API_KEYS} valid keys`,
    );
  }
  return Object.freeze([...new Set(parsed.data)]);
}

export function parseAiRunProvenance(input: unknown): AiRunProvenance {
  const parsed = z
    .object({ provider: AiProviderSchema, model: AiModelSchema })
    .strict()
    .parse(input);
  return Object.freeze(parsed);
}

export function loadAiRunProvenance(
  environment: Record<string, string | undefined> = process.env,
): AiRunProvenance {
  return parseAiRunProvenance({
    provider: environment.AI_PROVIDER,
    model: environment.AI_MODEL,
  });
}

/**
 * Validates injected values without reading process.env. Environment access
 * stays at runtime composition boundaries and browser input cannot override
 * provider, endpoint, model, or credentials.
 */
export function parseAiRuntimeConfig(input: unknown): AiRuntimeConfig {
  const parsed = AiRuntimeConfigSchema.parse(input);
  return Object.freeze({
    ...parsed,
    apiKeys: Object.freeze([...new Set(parsed.apiKeys)]),
  });
}
