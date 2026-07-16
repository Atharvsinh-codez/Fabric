import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructorOptions: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    interactions: { create: (request: unknown, options: unknown) => unknown };

    constructor(options: unknown) {
      sdk.constructorOptions.push(options);
      const apiKey = (options as { apiKey: string }).apiKey;
      this.interactions = {
        create: (request, requestOptions) => sdk.create(apiKey, request, requestOptions),
      };
    }
  },
}));

import { APPROVED_GEMINI_MODEL, parseAiRuntimeConfig } from "../config";
import type { ModelStreamEvent } from "../contracts";
import {
  GeminiInteractionsProvider,
  resetGeminiKeyCursorForTests,
} from "./gemini";

const API_KEYS = [
  "AQ.pool-key-one-with-enough-entropy",
  "AQ.pool-key-two-with-enough-entropy",
  "AQ.pool-key-three-with-enough-entropy",
] as const;

const turnRequest = {
  input: "bounded input",
  systemInstruction: "system contract",
  thinkingLevel: "medium" as const,
  maxOutputTokens: 16_384,
  responseSchema: { type: "object" },
  timeoutMs: 45_000,
};

function createProvider(apiKeys: readonly string[] = [API_KEYS[0]]) {
  return new GeminiInteractionsProvider(
    parseAiRuntimeConfig({
      apiKeys,
      model: APPROVED_GEMINI_MODEL,
      storeInteractions: false,
      requestTimeoutMs: 45_000,
    }),
  );
}

function completedStream(interactionId: string) {
  return (async function* () {
    yield {
      event_type: "interaction.completed",
      interaction: { id: interactionId, status: "completed", usage: {} },
    };
  })();
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.constructorOptions.length = 0;
  resetGeminiKeyCursorForTests(0);
});

describe("GeminiInteractionsProvider", () => {
  it("uses only the approved stateless streaming Interactions contract", async () => {
    sdk.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: "interaction.created",
          interaction: { id: "interaction_1", status: "in_progress" },
        };
        yield {
          event_type: "step.delta",
          index: 0,
          delta: { type: "thought_signature", signature: "private-reasoning-signature" },
        };
        yield {
          event_type: "step.delta",
          index: 1,
          delta: { type: "text", text: "{\"schemaVersion\":1}" },
        };
        yield {
          event_type: "interaction.completed",
          interaction: {
            id: "interaction_1",
            status: "completed",
            usage: { total_input_tokens: 10, total_output_tokens: 5, total_tokens: 15 },
          },
        };
      })(),
    );

    const provider = new GeminiInteractionsProvider(
      parseAiRuntimeConfig({
        apiKeys: [API_KEYS[0]],
        model: APPROVED_GEMINI_MODEL,
        storeInteractions: false,
        requestTimeoutMs: 45_000,
      }),
    );
    const turn = await provider.createTurn({
      input: "bounded input",
      systemInstruction: "system contract",
      thinkingLevel: "medium",
      maxOutputTokens: 16_384,
      responseSchema: { type: "object" },
      timeoutMs: 45_000,
    });
    const events: ModelStreamEvent[] = [];
    for await (const event of turn.events) events.push(event);

    expect(sdk.constructorOptions).toEqual([{ apiKey: API_KEYS[0] }]);
    expect(sdk.create).toHaveBeenCalledOnce();
    const [, request, options] = sdk.create.mock.calls[0];
    expect(request).toMatchObject({
      model: APPROVED_GEMINI_MODEL,
      input: "bounded input",
      system_instruction: "system contract",
      stream: true,
      store: false,
      generation_config: { max_output_tokens: 16_384, thinking_level: "medium" },
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: { type: "object" },
      },
    });
    expect(options).toMatchObject({ timeout: 45_000, maxRetries: 0 });
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("previous_interaction_id");
    expect(events).toEqual([
      { type: "interaction_started", interactionId: "interaction_1" },
      { type: "text_delta", text: "{\"schemaVersion\":1}" },
      {
        type: "interaction_completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
    ]);
  });

  it("fails incomplete interactions as invalid output instead of retryable busy state", async () => {
    sdk.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: "interaction.created",
          interaction: { id: "interaction_2", status: "in_progress" },
        };
        yield {
          event_type: "interaction.status_update",
          status: "incomplete",
        };
      })(),
    );

    const provider = new GeminiInteractionsProvider(
      parseAiRuntimeConfig({
        apiKeys: [API_KEYS[0]],
        model: APPROVED_GEMINI_MODEL,
        storeInteractions: false,
        requestTimeoutMs: 45_000,
      }),
    );
    const turn = await provider.createTurn({
      input: "bounded input",
      systemInstruction: "system contract",
      thinkingLevel: "high",
      maxOutputTokens: 16_384,
      responseSchema: { type: "object" },
      timeoutMs: 45_000,
    });

    const events: ModelStreamEvent[] = [];
    await expect(async () => {
      for await (const event of turn.events) events.push(event);
    }).rejects.toMatchObject({
      code: "invalid_request",
      retryable: false,
    });
    expect(events).toEqual([
      { type: "interaction_started", interactionId: "interaction_2" },
    ]);
  });

  it.each([
    [429, "rate_limited"],
    [409, "provider_unavailable"],
    [503, "provider_unavailable"],
  ] as const)("normalizes exhausted HTTP %s retries", async (status, code) => {
    sdk.create.mockRejectedValue(Object.assign(new Error("provider details"), { status }));

    const provider = new GeminiInteractionsProvider(
      parseAiRuntimeConfig({
        apiKeys: [API_KEYS[0]],
        model: APPROVED_GEMINI_MODEL,
        storeInteractions: false,
        requestTimeoutMs: 45_000,
      }),
    );

    await expect(provider.createTurn({
      input: "bounded input",
      systemInstruction: "system contract",
      thinkingLevel: "medium",
      maxOutputTokens: 16_384,
      responseSchema: { type: "object" },
      timeoutMs: 45_000,
    })).rejects.toMatchObject({ code, retryable: true });
    expect(sdk.create).toHaveBeenCalledOnce();
    expect(sdk.create.mock.calls[0]?.[2]).toMatchObject({ maxRetries: 0 });
  });

  it("rotates sequential requests across keys and provider instances", async () => {
    sdk.create.mockImplementation((apiKey: string) =>
      Promise.resolve(completedStream(`interaction-${apiKey}`)),
    );
    const firstProvider = createProvider(API_KEYS);
    const secondProvider = createProvider(API_KEYS);

    await firstProvider.createTurn(turnRequest);
    await secondProvider.createTurn(turnRequest);
    await firstProvider.createTurn(turnRequest);
    await secondProvider.createTurn(turnRequest);

    expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual([
      API_KEYS[0],
      API_KEYS[1],
      API_KEYS[2],
      API_KEYS[0],
    ]);
  });

  it("uses the durable job ordinal across isolated provider instances", async () => {
    sdk.create.mockImplementation((apiKey: string) =>
      Promise.resolve(completedStream(`interaction-${apiKey}`)),
    );

    await createProvider(API_KEYS).createTurn({
      ...turnRequest,
      keyRotationOrdinal: 5,
    });
    resetGeminiKeyCursorForTests(2);
    await createProvider(API_KEYS).createTurn({
      ...turnRequest,
      keyRotationOrdinal: 6,
    });

    expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual([
      API_KEYS[2],
      API_KEYS[0],
    ]);
  });

  it("reserves distinct initial keys for concurrent requests", async () => {
    const releases: Array<(source: ReturnType<typeof completedStream>) => void> = [];
    sdk.create.mockImplementation(() =>
      new Promise<ReturnType<typeof completedStream>>((resolve) => releases.push(resolve)),
    );
    const providers = API_KEYS.map(() => createProvider(API_KEYS));

    const turns = providers.map((provider) => provider.createTurn(turnRequest));
    expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual(API_KEYS);
    releases.forEach((release, index) => release(completedStream(`interaction-${index}`)));
    await Promise.all(turns);
  });

  it.each([408, 409, 429, 503])(
    "fails over a pre-stream HTTP %s without nested SDK retries",
    async (status) => {
      sdk.create.mockImplementation((apiKey: string) =>
        apiKey === API_KEYS[0]
          ? Promise.reject(Object.assign(new Error("provider details"), { status }))
          : Promise.resolve(completedStream("interaction-failover")),
      );
      const provider = createProvider(API_KEYS);

      await expect(provider.createTurn(turnRequest)).resolves.toBeDefined();
      expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual([
        API_KEYS[0],
        API_KEYS[1],
      ]);
      expect(
        sdk.create.mock.calls.map(([, , options]) => options),
      ).toEqual([
        expect.objectContaining({ maxRetries: 0 }),
        expect.objectContaining({ maxRetries: 0 }),
      ]);
    },
  );

  it("fails over a pre-stream transport failure", async () => {
    sdk.create.mockImplementation((apiKey: string) =>
      apiKey === API_KEYS[0]
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(completedStream("interaction-transport-failover")),
    );
    const provider = createProvider(API_KEYS);

    await expect(provider.createTurn(turnRequest)).resolves.toBeDefined();
    expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual([
      API_KEYS[0],
      API_KEYS[1],
    ]);
  });

  it.each(["APIConnectionError", "APIConnectionTimeoutError"])(
    "fails over the SDK's pre-stream %s wrapper",
    async (name) => {
      sdk.create.mockImplementation((apiKey: string) => {
        if (apiKey !== API_KEYS[0]) {
          return Promise.resolve(completedStream("interaction-sdk-wrapper-failover"));
        }
        const error = new Error("connection details");
        error.name = name;
        return Promise.reject(error);
      });
      const provider = createProvider(API_KEYS);

      await expect(provider.createTurn(turnRequest)).resolves.toBeDefined();
      expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual([
        API_KEYS[0],
        API_KEYS[1],
      ]);
    },
  );

  it("does not fail over an SDK-wrapped user abort", async () => {
    const controller = new AbortController();
    sdk.create.mockImplementation(() => {
      controller.abort("canceled");
      const error = new Error("request aborted");
      error.name = "APIUserAbortError";
      return Promise.reject(error);
    });
    const provider = createProvider(API_KEYS);

    await expect(provider.createTurn({
      ...turnRequest,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted", retryable: false });
    expect(sdk.create).toHaveBeenCalledOnce();
  });

  it.each([401, 403])(
    "fails over a pre-stream authentication HTTP %s",
    async (status) => {
      sdk.create.mockImplementation((apiKey: string) =>
        apiKey === API_KEYS[0]
          ? Promise.reject(Object.assign(new Error("provider details"), { status }))
          : Promise.resolve(completedStream("interaction-auth-failover")),
      );
      const provider = createProvider(API_KEYS);

      await expect(provider.createTurn(turnRequest)).resolves.toBeDefined();
      expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual([
        API_KEYS[0],
        API_KEYS[1],
      ]);
      expect(sdk.create.mock.calls.every(([, , options]) =>
        (options as { maxRetries: number }).maxRetries === 0
      )).toBe(true);
    },
  );

  it.each([401, 403])(
    "normalizes all-key authentication HTTP %s exhaustion",
    async (status) => {
      sdk.create.mockRejectedValue(
        Object.assign(new Error("provider details"), { status }),
      );
      const provider = createProvider(API_KEYS);

      await expect(provider.createTurn(turnRequest)).rejects.toMatchObject({
        code: "provider_authentication_failed",
        retryable: false,
      });
      expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual(API_KEYS);
    },
  );

  it("normalizes a rate limit after every key is exhausted", async () => {
    sdk.create.mockRejectedValue(
      Object.assign(new Error("provider details"), { status: 429 }),
    );
    const provider = createProvider(API_KEYS);

    await expect(provider.createTurn(turnRequest)).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
    expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual(API_KEYS);
  });

  it("caps failover fan-out when the configured pool is large", async () => {
    const extendedKeys = [
      ...API_KEYS,
      "AQ.pool-key-four-with-enough-entropy",
      "AQ.pool-key-five-with-enough-entropy",
    ] as const;
    sdk.create.mockRejectedValue(
      Object.assign(new Error("provider details"), { status: 429 }),
    );
    const provider = createProvider(extendedKeys);

    await expect(provider.createTurn({
      ...turnRequest,
      keyRotationOrdinal: 0,
    })).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    expect(sdk.create.mock.calls.map(([apiKey]) => apiKey)).toEqual(
      extendedKeys.slice(0, 3),
    );
  });

  it("does not replay a model turn after its stream has started", async () => {
    sdk.create.mockResolvedValue(
      (async function* () {
        yield {
          event_type: "interaction.created",
          interaction: { id: "interaction_3", status: "in_progress" },
        };
        yield {
          event_type: "error",
          error: { code: "resource_exhausted" },
        };
      })(),
    );

    const provider = new GeminiInteractionsProvider(
      parseAiRuntimeConfig({
        apiKeys: [API_KEYS[0], API_KEYS[1]],
        model: APPROVED_GEMINI_MODEL,
        storeInteractions: false,
        requestTimeoutMs: 45_000,
      }),
    );
    const turn = await provider.createTurn({
      input: "bounded input",
      systemInstruction: "system contract",
      thinkingLevel: "medium",
      maxOutputTokens: 16_384,
      responseSchema: { type: "object" },
      timeoutMs: 45_000,
    });

    await expect(async () => {
      for await (const event of turn.events) void event;
    }).rejects.toMatchObject({ code: "rate_limited", retryable: true });
    expect(sdk.create).toHaveBeenCalledOnce();
  });
});
