import { describe, expect, it } from "vitest";

import { BoardApiError, readJsonBody, requireSameOrigin } from "./http";

describe("board API HTTP protections", () => {
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
