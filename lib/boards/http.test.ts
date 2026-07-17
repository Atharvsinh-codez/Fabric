import { afterEach, describe, expect, it, vi } from "vitest";

import { SITE_URL } from "@/lib/site";
import { BoardApiError, readJsonBody, requireSameOrigin } from "./http";

describe("board API HTTP protections", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts an exact same-origin mutation", () => {
    const request = new Request("https://fabric.example/api/boards", {
      method: "POST",
      headers: { origin: "https://fabric.example" },
    });
    expect(() => requireSameOrigin(request)).not.toThrow();
  });

  it("uses the canonical application origin behind a wildcard listener", () => {
    const request = new Request("http://0.0.0.0:3000/api/boards", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(() => requireSameOrigin(request, "http://localhost:3000")).not.toThrow();
  });

  it("uses the canonical site origin in production despite stale deployment URLs", () => {
    vi.stubEnv("FABRIC_ENV", "production");
    vi.stubEnv("APP_URL", "https://stale-deployment.example");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://stale-public.example");

    const request = new Request(`${SITE_URL.origin}/api/realtime/ticket`, {
      method: "POST",
      headers: { origin: SITE_URL.origin },
    });
    expect(() => requireSameOrigin(request)).not.toThrow();

    const staleOrigin = new Request(`${SITE_URL.origin}/api/realtime/ticket`, {
      method: "POST",
      headers: { origin: "https://stale-deployment.example" },
    });
    expect(() => requireSameOrigin(staleOrigin)).toThrowError(
      expect.objectContaining({ status: 403, code: "forbidden_origin" }),
    );
  });

  it("continues to use the configured application origin outside production", () => {
    vi.stubEnv("FABRIC_ENV", "local");
    vi.stubEnv("APP_URL", "http://localhost:3000");

    const request = new Request("http://0.0.0.0:3000/api/boards", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(() => requireSameOrigin(request)).not.toThrow();
  });

  it("rejects cross-origin and originless mutations", () => {
    const crossOrigin = new Request("https://fabric.example/api/boards", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });
    expect(() => requireSameOrigin(crossOrigin)).toThrowError(BoardApiError);
    expect(() =>
      requireSameOrigin(new Request("https://fabric.example/api/boards", { method: "POST" })),
    ).toThrowError(BoardApiError);
  });

  it("enforces the byte limit before JSON parsing", async () => {
    const request = new Request("https://fabric.example/api/boards", {
      method: "POST",
      body: JSON.stringify({ value: "too long" }),
    });
    await expect(readJsonBody(request, 4)).rejects.toMatchObject({
      status: 413,
      code: "request_too_large",
    });
  });
});
