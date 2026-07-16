import { describe, expect, it, vi } from "vitest";

import { requestRealtimeTicket, resolveRealtimeUrl } from "./ticket";

describe("realtime ticket client", () => {
  it("requests an authenticated ticket from the same origin with no-store semantics", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
      });
      return Response.json({
        protocolVersion: 1,
        ticket: "t".repeat(64),
        expiresAt: "2026-07-13T12:00:00.000Z",
        boardId: "22222222-2222-4222-8222-222222222222",
        documentGenerationId: "33333333-3333-4333-8333-333333333333",
        capabilities: ["read", "write", "awareness"],
      });
    });

    const result = await requestRealtimeTicket({
      boardId: "22222222-2222-4222-8222-222222222222",
      pageOrigin: "https://fabric.example",
      fetchImplementation,
    });
    expect(result.documentGenerationId).toBe("33333333-3333-4333-8333-333333333333");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("rejects cross-origin ticket endpoints and insecure sockets on secure pages", async () => {
    await expect(
      requestRealtimeTicket({
        boardId: "22222222-2222-4222-8222-222222222222",
        endpoint: "https://evil.example/ticket",
        pageOrigin: "https://fabric.example",
        fetchImplementation: vi.fn<typeof fetch>(),
      }),
    ).rejects.toThrow("same-origin");
    expect(() =>
      resolveRealtimeUrl(
        "ws://realtime.fabric.example/realtime",
        "https://fabric.example/board",
      ),
    ).toThrow("secure realtime");
  });

  it("routes a socket to one board generation without putting the ticket in the URL", () => {
    expect(
      resolveRealtimeUrl(
        "wss://fabric-realtime.example/realtime",
        "https://fabric.example/board",
        {
          boardId: "22222222-2222-4222-8222-222222222222",
          documentGenerationId: "33333333-3333-4333-8333-333333333333",
        },
      ),
    ).toBe(
      "wss://fabric-realtime.example/realtime/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
    );
  });
});
