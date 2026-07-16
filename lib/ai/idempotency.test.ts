import { describe, expect, it } from "vitest";

import {
  hashIdempotencyKey,
  parseIdempotencyKey,
  resolveIdempotentRun,
} from "./idempotency";

describe("AI run idempotency", () => {
  it("reuses only an exact input match", () => {
    expect(resolveIdempotentRun({ id: "run-1", inputHash: "same" }, "same")).toEqual({
      action: "reuse",
      runId: "run-1",
    });
    expect(resolveIdempotentRun({ id: "run-1", inputHash: "old" }, "new")).toEqual({
      action: "conflict",
    });
    expect(resolveIdempotentRun(null, "new")).toEqual({ action: "create" });
  });

  it("accepts bounded opaque keys and hashes them per principal", () => {
    expect(parseIdempotencyKey("request_1234")).toBe("request_1234");
    expect(parseIdempotencyKey("tiny")).toBeNull();
    expect(hashIdempotencyKey("user-a", "request_1234")).not.toBe(
      hashIdempotencyKey("user-b", "request_1234"),
    );
  });
});
