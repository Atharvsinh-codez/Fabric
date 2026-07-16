import { describe, expect, it } from "vitest";

import { hmacTicketIdentifier } from "./hashing";
import { classifyIdempotency } from "./idempotency";

describe("realtime idempotency", () => {
  it("classifies new, duplicate, and modified-payload message reuse", () => {
    expect(classifyIdempotency(undefined, "aaa")).toEqual({ kind: "new" });
    expect(classifyIdempotency("aaa", "aaa")).toEqual({ kind: "replay" });
    expect(classifyIdempotency("aaa", "bbb")).toEqual({ kind: "conflict" });
  });

  it("derives a stable non-reversible ticket redemption key", () => {
    const digest = hmacTicketIdentifier(
      "55555555-5555-4555-8555-555555555555",
      "purpose-separated-redemption-key-with-32-chars",
    );
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("55555555");
    expect(
      hmacTicketIdentifier(
        "55555555-5555-4555-8555-555555555555",
        "purpose-separated-redemption-key-with-32-chars",
      ),
    ).toBe(digest);
  });
});
