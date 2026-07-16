import { describe, expect, it } from "vitest";

import { GET } from "./route";

describe("liveness route", () => {
  it("returns a no-store success response without dependency details", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
