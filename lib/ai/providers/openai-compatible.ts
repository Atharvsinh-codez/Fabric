import { FABRIC_AI_PROVIDER, type AiRuntimeConfig } from "../config";
import {
  FabricModelError,
  type FabricModelProvider,
  type ModelImageInput,
  type ModelStreamEvent,
  type ModelTurn,
  type ModelTurnRequest,
  type ModelUsage,
} from "../contracts";

const MAX_CLIENT_ATTEMPTS_PER_TURN = 3;
const MAX_SSE_EVENT_CHARACTERS = 1_048_576;
const MAX_MODEL_IMAGES = 5;
const ACKNOWLEDGED_SILENT_STREAM_DEADLINE =
  "acknowledged_stream_deadline_before_content" as const;

class ProviderDiagnosticError extends FabricModelError {
  constructor(
    code: "provider_stream_failed",
    message: string,
    retryable: boolean,
    readonly diagnosticCode: typeof ACKNOWLEDGED_SILENT_STREAM_DEADLINE,
  ) {
    super(code, message, retryable);
    this.name = "ProviderDiagnosticError";
  }
}

function imageContentParts(images: readonly ModelImageInput[] | undefined) {
  if (!images?.length) return null;
  if (images.length > MAX_MODEL_IMAGES) {
    throw new FabricModelError("invalid_request", "The model image limit was exceeded");
  }
  return images.flatMap((image) => {
    let url: URL;
    try {
      url = new URL(image.url);
    } catch {
      throw new FabricModelError("invalid_request", "The model image URL is invalid");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      image.url.length > 4_096 ||
      image.label.length < 1 ||
      image.label.length > 200
    ) {
      throw new FabricModelError("invalid_request", "The model image input is invalid");
    }
    return [
      { type: "text", text: image.label },
      {
        type: "image_url",
        image_url: { url: image.url, detail: image.detail ?? "auto" },
      },
    ] as const;
  });
}

class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super("The model provider returned an unsuccessful response");
    this.name = "ProviderHttpError";
  }
}

type RequestDeadline = Readonly<{
  signal: AbortSignal;
  didTimeout: () => boolean;
  cleanup: () => void;
}>;

function createRequestDeadline(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestDeadline {
  const controller = new AbortController();
  let timedOut = false;
  const forwardExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) {
    forwardExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", forwardExternalAbort, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Model request deadline exceeded", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", forwardExternalAbort);
    },
  };
}

function providerStatus(error: unknown): number | undefined {
  return error instanceof ProviderHttpError ? error.status : undefined;
}

function canFailOverBeforeStream(error: unknown): boolean {
  const status = providerStatus(error);
  return (
    error instanceof TypeError ||
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (status !== undefined && status >= 500 && status < 600)
  );
}

function normalizeProviderError(
  error: unknown,
  context?: {
    externalSignal?: AbortSignal;
    didTimeout?: boolean;
    streamAcknowledged?: boolean;
    textDeltaSeen?: boolean;
    timeoutMs?: number;
  },
): FabricModelError {
  if (error instanceof FabricModelError) return error;
  if (context?.externalSignal?.aborted) {
    return new FabricModelError("aborted", "The model request was canceled");
  }
  if (context?.didTimeout) {
    if (context.streamAcknowledged && !context.textDeltaSeen) {
      console.warn("[fabric-ai-provider] provider stream deadline", {
        diagnosticCode: ACKNOWLEDGED_SILENT_STREAM_DEADLINE,
        timeoutMs: context.timeoutMs,
      });
      return new ProviderDiagnosticError(
        "provider_stream_failed",
        "The model stream deadline was exceeded after acknowledgement before content",
        true,
        ACKNOWLEDGED_SILENT_STREAM_DEADLINE,
      );
    }
    return new FabricModelError(
      "provider_stream_failed",
      "The model request deadline was exceeded",
      true,
    );
  }
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return new FabricModelError("aborted", "The model request was canceled");
  }

  const status = providerStatus(error);
  if (status === 429) {
    return new FabricModelError("rate_limited", "The model is temporarily rate limited", true);
  }
  if (status === 401 || status === 403) {
    return new FabricModelError(
      "provider_authentication_failed",
      "The model provider is not configured correctly",
    );
  }
  if (
    status === 408 ||
    status === 409 ||
    status === 425 ||
    (status !== undefined && status >= 500)
  ) {
    return new FabricModelError("provider_unavailable", "The model provider is unavailable", true);
  }
  if (status !== undefined && status >= 400) {
    return new FabricModelError("invalid_request", "The model rejected the request");
  }
  return new FabricModelError("provider_stream_failed", "The model stream failed", true);
}

function streamPayloadError(payload: Record<string, unknown>): FabricModelError | null {
  const error = payload.error;
  if (!error || typeof error !== "object") return null;
  const details = error as Record<string, unknown>;
  const code = typeof details.code === "string" ? details.code.toLowerCase() : "";
  const type = typeof details.type === "string" ? details.type.toLowerCase() : "";
  const category = `${code}:${type}`;
  if (/rate|quota|resource_exhausted/u.test(category)) {
    return new FabricModelError("rate_limited", "The model is temporarily rate limited", true);
  }
  if (/auth|api_key|permission|forbidden|unauthorized/u.test(category)) {
    return new FabricModelError(
      "provider_authentication_failed",
      "The model provider is not configured correctly",
    );
  }
  if (/invalid|bad_request|context_length/u.test(category)) {
    return new FabricModelError("invalid_request", "The model rejected the request");
  }
  return new FabricModelError("provider_stream_failed", "The model stream returned an error", true);
}

function safeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeUsage(value: unknown): ModelUsage {
  if (!value || typeof value !== "object") return {};
  const usage = value as Record<string, unknown>;
  const promptDetails = usage.prompt_tokens_details &&
      typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details as Record<string, unknown>
    : undefined;
  const completionDetails = usage.completion_tokens_details &&
      typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details as Record<string, unknown>
    : undefined;
  return {
    inputTokens: safeTokenCount(usage.prompt_tokens),
    outputTokens: safeTokenCount(usage.completion_tokens),
    cachedTokens: safeTokenCount(promptDetails?.cached_tokens),
    thoughtTokens: safeTokenCount(completionDetails?.reasoning_tokens),
    totalTokens: safeTokenCount(usage.total_tokens),
  };
}

function extractTextDelta(delta: unknown): string {
  if (!delta || typeof delta !== "object") return "";
  const content = (delta as Record<string, unknown>).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    })
    .join("");
}

function parseSseData(event: string): string | null {
  const data: string[] = [];
  for (const line of event.split(/\r?\n/u)) {
    if (!line.startsWith("data:")) continue;
    const value = line.slice(5);
    data.push(value.startsWith(" ") ? value.slice(1) : value);
  }
  return data.length > 0 ? data.join("\n") : null;
}

async function* iterateSseData(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reachedEnd = false;
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) {
        reachedEnd = true;
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = /\r?\n\r?\n/u.exec(buffer);
      while (boundary?.index !== undefined) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = parseSseData(event);
        if (data !== null) yield data;
        boundary = /\r?\n\r?\n/u.exec(buffer);
      }
      if (buffer.length > MAX_SSE_EVENT_CHARACTERS) {
        throw new FabricModelError(
          "provider_stream_failed",
          "The model stream event exceeded its safety limit",
        );
      }
    }

    if (buffer.trim()) {
      if (buffer.length > MAX_SSE_EVENT_CHARACTERS) {
        throw new FabricModelError(
          "provider_stream_failed",
          "The model stream event exceeded its safety limit",
        );
      }
      const data = parseSseData(buffer);
      if (data !== null) yield data;
    }
  } finally {
    if (!reachedEnd) {
      try {
        await reader.cancel();
      } catch {
        // The provider or abort signal may already have closed the body.
      }
    }
    reader.releaseLock();
  }
}

async function* toModelEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<ModelStreamEvent> {
  let interactionStarted = false;
  let terminalMarkerSeen = false;
  let finishReasonSeen = false;
  let usage: ModelUsage = {};

  for await (const data of iterateSseData(body, signal)) {
    signal.throwIfAborted();
    if (data.trim() === "[DONE]") {
      terminalMarkerSeen = true;
      break;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw new FabricModelError(
        "provider_stream_failed",
        "The model stream contained malformed data",
        true,
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new FabricModelError(
        "provider_stream_failed",
        "The model stream contained malformed data",
        true,
      );
    }

    const chunk = payload as Record<string, unknown>;
    const payloadError = streamPayloadError(chunk);
    if (payloadError) throw payloadError;

    if (!interactionStarted && typeof chunk.id === "string" && chunk.id.length > 0) {
      interactionStarted = true;
      yield { type: "interaction_started", interactionId: chunk.id };
    }

    if (Array.isArray(chunk.choices)) {
      for (const choice of chunk.choices) {
        if (!choice || typeof choice !== "object") continue;
        const choiceRecord = choice as Record<string, unknown>;
        const text = extractTextDelta(choiceRecord.delta);
        if (text) yield { type: "text_delta", text };
        if (typeof choiceRecord.finish_reason === "string") finishReasonSeen = true;
      }
    }
    if (chunk.usage !== undefined) usage = normalizeUsage(chunk.usage);
  }

  if (!terminalMarkerSeen && !finishReasonSeen) {
    throw new FabricModelError(
      "provider_stream_failed",
      "The model stream ended before completion",
      true,
    );
  }
  yield { type: "interaction_completed", usage };
}

export class OpenAiCompatibleChatProvider implements FabricModelProvider {
  readonly provider = FABRIC_AI_PROVIDER;
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKeys: readonly string[];
  private readonly requestTimeoutMs: number;
  private nextKeyIndex = 0;

  constructor(
    config: AiRuntimeConfig,
    private readonly fetchImplementation: typeof fetch = globalThis.fetch,
  ) {
    if (config.provider !== FABRIC_AI_PROVIDER) {
      throw new Error("Unsupported AI provider configuration");
    }
    if (config.streamOnly !== true) throw new Error("AI requests must use streaming mode");
    if (config.apiKeys.length === 0) throw new Error("At least one AI API key is required");
    if (typeof fetchImplementation !== "function") {
      throw new Error("A Fetch API implementation is required");
    }
    this.model = config.model;
    this.endpoint = `${config.baseUrl}/chat/completions`;
    this.apiKeys = config.apiKeys;
    this.requestTimeoutMs = config.requestTimeoutMs;
  }

  private reserveInitialKeyIndex(durableOrdinal?: number): number {
    if (durableOrdinal !== undefined) {
      if (!Number.isSafeInteger(durableOrdinal) || durableOrdinal < 0) {
        throw new Error("Invalid AI key rotation ordinal");
      }
      return durableOrdinal % this.apiKeys.length;
    }
    const reserved = this.nextKeyIndex;
    this.nextKeyIndex = reserved >= Number.MAX_SAFE_INTEGER ? 0 : reserved + 1;
    return reserved % this.apiKeys.length;
  }

  async createTurn(request: ModelTurnRequest): Promise<ModelTurn> {
    if (request.signal?.aborted) {
      throw new FabricModelError("aborted", "The model request was canceled");
    }
    const initialKeyIndex = this.reserveInitialKeyIndex(request.keyRotationOrdinal);
    const imageParts = imageContentParts(request.images);
    const timeoutMs = Math.min(request.timeoutMs, this.requestTimeoutMs);
    const deadline = createRequestDeadline(request.signal, timeoutMs);
    const requestBody = JSON.stringify({
      model: this.model,
      messages: [
        { role: "system", content: request.systemInstruction },
        {
          role: "user",
          content: imageParts
            ? [{ type: "text", text: request.input }, ...imageParts]
            : request.input,
        },
      ],
      max_tokens: request.maxOutputTokens,
      reasoning_effort:
        request.thinkingLevel === "high"
          ? "high"
          : request.thinkingLevel === "medium"
            ? "medium"
            : "low",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "fabric_board_plan",
          // Runtime Zod validation remains authoritative. Non-strict mode is
          // intentional because OpenAI-compatible gateways implement different
          // strict-schema subsets (notably root unions and optional fields).
          strict: false,
          schema: request.responseSchema,
        },
      },
      stream: true,
      stream_options: { include_usage: true },
    });

    try {
      let lastError: unknown;
      const attemptCount = Math.min(this.apiKeys.length, MAX_CLIENT_ATTEMPTS_PER_TURN);
      for (let offset = 0; offset < attemptCount; offset += 1) {
        deadline.signal.throwIfAborted();
        const apiKey = this.apiKeys[(initialKeyIndex + offset) % this.apiKeys.length];
        try {
          const response = await this.fetchImplementation(this.endpoint, {
            method: "POST",
            cache: "no-store",
            redirect: "error",
            headers: {
              Accept: "text/event-stream",
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: requestBody,
            signal: deadline.signal,
          });
          if (!response.ok) {
            try {
              await response.body?.cancel();
            } catch {
              // Nothing from an error response is included in logs or errors.
            }
            throw new ProviderHttpError(response.status);
          }
          if (!response.body) {
            throw new FabricModelError(
              "provider_stream_failed",
              "The model provider returned no stream",
              true,
            );
          }

          const externalSignal = request.signal;
          const didTimeout = deadline.didTimeout;
          const cleanup = deadline.cleanup;
          const body = response.body;
          return {
            events: (async function* () {
              let streamAcknowledged = false;
              let textDeltaSeen = false;
              try {
                for await (const event of toModelEvents(body, deadline.signal)) {
                  if (event.type === "interaction_started") streamAcknowledged = true;
                  if (event.type === "text_delta") textDeltaSeen = true;
                  yield event;
                }
              } catch (error) {
                throw normalizeProviderError(error, {
                  externalSignal,
                  didTimeout: didTimeout(),
                  streamAcknowledged,
                  textDeltaSeen,
                  timeoutMs,
                });
              } finally {
                cleanup();
              }
            })(),
          };
        } catch (error) {
          lastError = error;
          if (request.signal?.aborted || deadline.didTimeout()) throw error;
          if (!canFailOverBeforeStream(error)) throw error;
        }
      }
      throw lastError;
    } catch (error) {
      deadline.cleanup();
      throw normalizeProviderError(error, {
        externalSignal: request.signal,
        didTimeout: deadline.didTimeout(),
      });
    }
  }
}
