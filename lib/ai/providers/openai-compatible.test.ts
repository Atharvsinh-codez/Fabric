import { describe, expect, it, vi } from "vitest";

import { parseAiRuntimeConfig } from "../config";
import type { ModelStreamEvent, ModelTurn } from "../contracts";
import { OpenAiCompatibleChatProvider } from "./openai-compatible";

const API_KEYS = [
  "sk-pool-key-one-with-enough-entropy",
  "sk-pool-key-two-with-enough-entropy",
  "sk-pool-key-three-with-enough-entropy",
  "sk-pool-key-four-with-enough-entropy",
] as const;

const turnRequest = {
  input: "bounded input",
  systemInstruction: "system contract",
  thinkingLevel: "medium" as const,
  maxOutputTokens: 16_384,
  responseSchema: { type: "object", additionalProperties: false },
  timeoutMs: 45_000,
};

function createConfig(
  apiKeys: readonly string[] = [API_KEYS[0]],
  requestTimeoutMs = 45_000,
) {
  return parseAiRuntimeConfig({
    provider: "openai-compatible",
    baseUrl: "https://provider.example.test/v1",
    apiKeys,
    model: "gcli/grok-4.5-medium",
    streamOnly: true,
    requestTimeoutMs,
  });
}

function streamingResponse(source: string, chunkSize = source.length): Response {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    chunks.push(encoder.encode(source.slice(offset, offset + chunkSize)));
  }
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }), {
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

function completedResponse(id = "chatcmpl-complete"): Response {
  return streamingResponse([
    `data: ${JSON.stringify({
      id,
      choices: [{ delta: { content: "{}" }, finish_reason: "stop" }],
    })}\n\n`,
    "data: [DONE]\n\n",
  ].join(""));
}

async function collect(turn: ModelTurn): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of turn.events) events.push(event);
  return events;
}

describe("OpenAiCompatibleChatProvider", () => {
  it("uses only streaming Chat Completions and incrementally parses SSE usage", async () => {
    const source = [
      ": provider comment\r\n",
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        choices: [{ delta: { role: "assistant", content: "{\"schema" }, finish_reason: null }],
      })}\r\n\r\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        choices: [{ delta: { content: "Version\":1}" }, finish_reason: "stop" }],
      })}\r\n\r\n`,
      `data: ${JSON.stringify({
        id: "chatcmpl-1",
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
          prompt_tokens_details: { cached_tokens: 3 },
          completion_tokens_details: { reasoning_tokens: 2 },
        },
      })}\r\n\r\n`,
      "data: [DONE]\r\n\r\n",
    ].join("");
    const fetchImplementation = vi.fn<typeof fetch>(async () => streamingResponse(source, 7));
    const provider = new OpenAiCompatibleChatProvider(createConfig(), fetchImplementation);

    const events = await collect(await provider.createTurn(turnRequest));

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://provider.example.test/v1/chat/completions");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEYS[0]}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gcli/grok-4.5-medium",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 16_384,
      reasoning_effort: "medium",
      messages: [
        { role: "system", content: "system contract" },
        { role: "user", content: "bounded input" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "fabric_board_plan", strict: false },
      },
    });
    expect(body).not.toHaveProperty("store");
    expect(body).not.toHaveProperty("tools");
    expect(events).toEqual([
      { type: "interaction_started", interactionId: "chatcmpl-1" },
      { type: "text_delta", text: "{\"schema" },
      { type: "text_delta", text: "Version\":1}" },
      {
        type: "interaction_completed",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedTokens: 3,
          thoughtTokens: 2,
          totalTokens: 15,
        },
      },
    ]);
  });

  it("round-robins starting keys and honors durable ordinals", async () => {
    const authorizations: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      authorizations.push((init?.headers as Record<string, string>).Authorization);
      return completedResponse();
    });
    const provider = new OpenAiCompatibleChatProvider(createConfig(API_KEYS), fetchImplementation);

    await collect(await provider.createTurn(turnRequest));
    await collect(await provider.createTurn(turnRequest));
    await collect(await provider.createTurn({ ...turnRequest, keyRotationOrdinal: 3 }));

    expect(authorizations).toEqual([
      `Bearer ${API_KEYS[0]}`,
      `Bearer ${API_KEYS[1]}`,
      `Bearer ${API_KEYS[3]}`,
    ]);
  });

  it("sends authorized image URLs as bounded multimodal content parts", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => completedResponse());
    const provider = new OpenAiCompatibleChatProvider(createConfig(), fetchImplementation);

    await collect(await provider.createTurn({
      ...turnRequest,
      images: [
        {
          url: "https://fabric.example.test/api/ai/media/signed-token",
          label: "Authorized selected board image 1.",
          detail: "high",
        },
      ],
    }));

    const body = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(body.messages[1]?.content).toEqual([
      { type: "text", text: "bounded input" },
      { type: "text", text: "Authorized selected board image 1." },
      {
        type: "image_url",
        image_url: {
          url: "https://fabric.example.test/api/ai/media/signed-token",
          detail: "high",
        },
      },
    ]);
  });

  it("rejects non-HTTPS or excessive image inputs before calling the provider", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => completedResponse());
    const provider = new OpenAiCompatibleChatProvider(createConfig(), fetchImplementation);

    await expect(provider.createTurn({
      ...turnRequest,
      images: [{ url: "data:image/png;base64,abc", label: "unsafe" }],
    })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(provider.createTurn({
      ...turnRequest,
      images: Array.from({ length: 6 }, (_, index) => ({
        url: `https://fabric.example.test/api/ai/media/${index}`,
        label: `image ${index}`,
      })),
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("fails over only before a stream starts and caps credential fan-out", async () => {
    const authorizations: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
      const authorization = (init?.headers as Record<string, string>).Authorization;
      authorizations.push(authorization);
      return authorization === `Bearer ${API_KEYS[0]}`
        ? new Response(null, { status: 429 })
        : completedResponse("chatcmpl-failover");
    });
    const provider = new OpenAiCompatibleChatProvider(createConfig(API_KEYS), fetchImplementation);

    await collect(await provider.createTurn({ ...turnRequest, keyRotationOrdinal: 0 }));
    expect(authorizations).toEqual([`Bearer ${API_KEYS[0]}`, `Bearer ${API_KEYS[1]}`]);

    const unavailable = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    await expect(new OpenAiCompatibleChatProvider(createConfig(API_KEYS), unavailable)
      .createTurn({ ...turnRequest, keyRotationOrdinal: 0 })).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
    expect(unavailable).toHaveBeenCalledTimes(3);
  });

  it("does not replay a turn after the provider has returned a stream", async () => {
    const response = streamingResponse(
      `data: ${JSON.stringify({
        id: "chatcmpl-error",
        choices: [{ delta: { content: "partial" }, finish_reason: null }],
      })}\n\ndata: ${JSON.stringify({ error: { code: "rate_limit_exceeded" } })}\n\n`,
    );
    const fetchImplementation = vi.fn<typeof fetch>(async () => response);
    const provider = new OpenAiCompatibleChatProvider(createConfig(API_KEYS), fetchImplementation);

    await expect(collect(await provider.createTurn(turnRequest))).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("propagates external cancellation as a safe abort", async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const provider = new OpenAiCompatibleChatProvider(createConfig(), fetchImplementation);
    const pending = provider.createTurn({ ...turnRequest, signal: controller.signal });
    controller.abort("canceled");

    await expect(pending).rejects.toMatchObject({ code: "aborted", retryable: false });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("keeps the timeout active for the streaming request lifetime", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn<typeof fetch>((_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("deadline", "AbortError"));
          });
        }));
      const provider = new OpenAiCompatibleChatProvider(createConfig(), fetchImplementation);
      const pending = provider.createTurn({ ...turnRequest, timeoutMs: 1_000 });
      const settled = pending.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(settled).resolves.toMatchObject({
        code: "provider_stream_failed",
        retryable: true,
      });
      expect(fetchImplementation).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("diagnoses an acknowledged silent stream only at the configured longer deadline", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const encoder = new TextEncoder();
      const fetchImplementation = vi.fn<typeof fetch>(async (_url, init) => {
        const signal = init?.signal;
        let removeAbortListener: () => void = () => undefined;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              id: "chatcmpl-acknowledged",
              choices: [],
            })}\n\n`));
            const failOnAbort = () => {
              controller.error(new DOMException("deadline", "AbortError"));
            };
            signal?.addEventListener("abort", failOnAbort, { once: true });
            removeAbortListener = () => signal?.removeEventListener("abort", failOnAbort);
          },
          cancel() {
            removeAbortListener();
          },
        });
        return new Response(body, {
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        });
      });
      const provider = new OpenAiCompatibleChatProvider(
        createConfig([API_KEYS[0]], 180_000),
        fetchImplementation,
      );
      const events: ModelStreamEvent[] = [];
      let settled = false;
      const outcome = (async () => {
        const turn = await provider.createTurn({ ...turnRequest, timeoutMs: 180_000 });
        for await (const event of turn.events) events.push(event);
      })().then(
        () => {
          settled = true;
          return { error: null };
        },
        (error: unknown) => {
          settled = true;
          return { error };
        },
      );

      await vi.advanceTimersByTimeAsync(45_001);
      expect(settled).toBe(false);
      expect(events).toEqual([
        { type: "interaction_started", interactionId: "chatcmpl-acknowledged" },
      ]);
      expect(warning).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(134_999);
      await expect(outcome).resolves.toMatchObject({
        error: {
          code: "provider_stream_failed",
          retryable: true,
          diagnosticCode: "acknowledged_stream_deadline_before_content",
        },
      });
      expect(warning).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith(
        "[fabric-ai-provider] provider stream deadline",
        {
          diagnosticCode: "acknowledged_stream_deadline_before_content",
          timeoutMs: 180_000,
        },
      );
      expect(fetchImplementation).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rejects malformed or prematurely ended SSE with safe stream errors", async () => {
    for (const response of [
      streamingResponse("data: not-json\n\n"),
      streamingResponse(`data: ${JSON.stringify({
        id: "chatcmpl-incomplete",
        choices: [{ delta: { content: "partial" }, finish_reason: null }],
      })}\n\n`),
    ]) {
      const provider = new OpenAiCompatibleChatProvider(
        createConfig(),
        vi.fn<typeof fetch>(async () => response),
      );
      await expect(collect(await provider.createTurn(turnRequest))).rejects.toMatchObject({
        code: "provider_stream_failed",
        retryable: true,
      });
    }
  });
});
