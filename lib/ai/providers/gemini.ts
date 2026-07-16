import { GoogleGenAI } from "@google/genai";

import { APPROVED_GEMINI_MODEL, type AiRuntimeConfig } from "../config";
import {
  FabricModelError,
  type FabricModelProvider,
  type ModelStreamEvent,
  type ModelTurn,
  type ModelTurnRequest,
  type ModelUsage,
} from "../contracts";

type ErrorWithStatus = Error & { status?: number; statusCode?: number };

const globalForGeminiPool = globalThis as typeof globalThis & {
  fabricGeminiKeyCursor?: number;
};

// Bound one user turn even when many credentials are configured. Round-robin
// distributes initial requests across the whole pool; failover probes at most
// two additional keys so a provider-wide incident cannot fan one run out 16x.
const MAX_CLIENT_ATTEMPTS_PER_TURN = 3;

function reserveInitialClientIndex(
  clientCount: number,
  durableOrdinal?: number,
): number {
  if (durableOrdinal !== undefined) {
    if (!Number.isSafeInteger(durableOrdinal) || durableOrdinal < 0) {
      throw new Error("Invalid Gemini key rotation ordinal");
    }
    return durableOrdinal % clientCount;
  }
  const cursor = globalForGeminiPool.fabricGeminiKeyCursor ??
    Math.floor(Math.random() * clientCount);
  globalForGeminiPool.fabricGeminiKeyCursor =
    cursor >= Number.MAX_SAFE_INTEGER ? 0 : cursor + 1;
  return cursor % clientCount;
}

export function resetGeminiKeyCursorForTests(nextCursor = 0): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("The Gemini key cursor can only be reset in tests");
  }
  globalForGeminiPool.fabricGeminiKeyCursor = nextCursor;
}

function providerStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const withStatus = error as ErrorWithStatus;
  return withStatus.status ?? withStatus.statusCode;
}

function isSdkConnectionError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === "APIConnectionError" ||
      error.name === "APIConnectionTimeoutError");
}

function isSdkUserAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "APIUserAbortError";
}

function canFailOverBeforeStream(error: unknown): boolean {
  const status = providerStatus(error);
  return error instanceof TypeError || isSdkConnectionError(error) ||
    status === 401 || status === 403 || status === 408 || status === 409 || status === 429 ||
    (status !== undefined && status >= 500 && status < 600);
}

function normalizeUsage(usage: {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cached_tokens?: number;
  total_thought_tokens?: number;
  total_tool_use_tokens?: number;
  total_tokens?: number;
} | undefined): ModelUsage {
  if (!usage) return {};
  return {
    inputTokens: usage.total_input_tokens,
    outputTokens: usage.total_output_tokens,
    cachedTokens: usage.total_cached_tokens,
    thoughtTokens: usage.total_thought_tokens,
    toolTokens: usage.total_tool_use_tokens,
    totalTokens: usage.total_tokens,
  };
}

function normalizeProviderError(error: unknown): FabricModelError {
  if (error instanceof FabricModelError) return error;
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError") ||
    isSdkUserAbortError(error)
  ) {
    return new FabricModelError("aborted", "The model request was canceled");
  }

  const status = providerStatus(error);
  if (status === 408 || status === 429) {
    return new FabricModelError("rate_limited", "The model is temporarily rate limited", true);
  }
  if (status === 401 || status === 403) {
    return new FabricModelError(
      "provider_authentication_failed",
      "The model provider is not configured correctly",
    );
  }
  if (status === 409) {
    return new FabricModelError("provider_unavailable", "The model provider is unavailable", true);
  }
  if (status !== undefined && status >= 500) {
    return new FabricModelError("provider_unavailable", "The model provider is unavailable", true);
  }
  if (status !== undefined && status >= 400) {
    return new FabricModelError("invalid_request", "The model rejected the request");
  }
  return new FabricModelError("provider_stream_failed", "The model stream failed", true);
}

export class GeminiInteractionsProvider implements FabricModelProvider {
  readonly provider = "google-gemini" as const;
  readonly model = APPROVED_GEMINI_MODEL;
  private readonly clients: readonly GoogleGenAI[];

  constructor(config: AiRuntimeConfig) {
    if (config.model !== APPROVED_GEMINI_MODEL) {
      throw new Error("Unapproved Gemini model configuration");
    }
    if (config.storeInteractions !== false) {
      throw new Error("Provider-side interaction storage is not approved");
    }
    if (config.apiKeys.length === 0) {
      throw new Error("At least one Gemini API key is required");
    }
    this.clients = Object.freeze(
      config.apiKeys.map((apiKey) => new GoogleGenAI({ apiKey })),
    );
  }

  async createTurn(request: ModelTurnRequest): Promise<ModelTurn> {
    request.signal?.throwIfAborted();

    try {
      const initialClientIndex = reserveInitialClientIndex(
        this.clients.length,
        request.keyRotationOrdinal,
      );
      const startedAt = Date.now();
      const source = await (async () => {
        let lastError: unknown;
        const attemptCount = Math.min(
          this.clients.length,
          MAX_CLIENT_ATTEMPTS_PER_TURN,
        );
        for (let offset = 0; offset < attemptCount; offset += 1) {
          request.signal?.throwIfAborted();
          const remainingTimeoutMs = offset === 0
            ? request.timeoutMs
            : request.timeoutMs - (Date.now() - startedAt);
          if (remainingTimeoutMs <= 0) {
            throw new FabricModelError(
              "provider_stream_failed",
              "The model request deadline was exceeded",
              true,
            );
          }
          const client = this.clients[(initialClientIndex + offset) % this.clients.length];
          try {
            return await client.interactions.create(
              {
                model: this.model,
                input: request.input,
                system_instruction: request.systemInstruction,
                stream: true,
                store: false,
                generation_config: {
                  max_output_tokens: request.maxOutputTokens,
                  thinking_level: request.thinkingLevel,
                },
                response_format: {
                  type: "text",
                  mime_type: "application/json",
                  schema: request.responseSchema,
                },
              },
              {
                timeout: remainingTimeoutMs,
                maxRetries: 0,
                fetchOptions: request.signal ? { signal: request.signal } : undefined,
              },
            );
          } catch (error) {
            lastError = error;
            if (request.signal?.aborted) throw error;
            if (!canFailOverBeforeStream(error)) throw error;
          }
        }
        throw lastError;
      })();

      const events = (async function* (): AsyncGenerator<ModelStreamEvent> {
        let completed = false;
        try {
          for await (const event of source) {
            request.signal?.throwIfAborted();

            if (event.event_type === "interaction.created") {
              yield { type: "interaction_started", interactionId: event.interaction.id };
              continue;
            }
            if (event.event_type === "interaction.status_update") {
              if (event.status === "requires_action") {
                throw new FabricModelError(
                  "invalid_request",
                  "The provider requested an unavailable tool",
                );
              }
              if (event.status === "incomplete") {
                throw new FabricModelError(
                  "invalid_request",
                  "The model stopped before returning a complete patch",
                );
              }
              if (event.status === "failed") {
                throw new FabricModelError(
                  "provider_stream_failed",
                  "The model interaction did not complete",
                  true,
                );
              }
              if (event.status === "budget_exceeded") {
                throw new FabricModelError(
                  "invalid_request",
                  "The model interaction exceeded its provider budget",
                );
              }
              if (event.status === "cancelled") {
                throw new FabricModelError("aborted", "The model interaction was canceled");
              }
              yield { type: "status", status: event.status };
              continue;
            }
            if (event.event_type === "step.delta" && event.delta.type === "text") {
              if (event.delta.text) yield { type: "text_delta", text: event.delta.text };
              continue;
            }
            if (event.event_type === "error") {
              const code = event.error?.code;
              const isRateLimit =
                code === "rate_limit_exceeded" || code === "resource_exhausted";
              const isTransient =
                isRateLimit ||
                code === "gateway_timeout" ||
                code === "deadline_exceeded" ||
                code === "internal" ||
                code === "unavailable";
              throw new FabricModelError(
                isRateLimit ? "rate_limited" : "provider_stream_failed",
                "The model stream returned an error",
                isTransient,
              );
            }
            if (event.event_type === "interaction.completed") {
              completed = true;
              yield {
                type: "interaction_completed",
                usage: normalizeUsage(event.interaction.usage),
              };
            }
          }
          if (!completed) {
            throw new FabricModelError(
              "provider_stream_failed",
              "The model stream ended before completion",
              true,
            );
          }
        } catch (error) {
          throw normalizeProviderError(error);
        }
      })();

      return { events };
    } catch (error) {
      throw normalizeProviderError(error);
    }
  }
}
