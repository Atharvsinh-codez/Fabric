import { describe, expect, it } from "vitest";

import { aiEventPollDelayMs } from "./event-poll-policy";

describe("AI event polling policy", () => {
  it("backs off bounded idle streams without delaying fresh activity", () => {
    expect(aiEventPollDelayMs(0)).toBe(250);
    expect(aiEventPollDelayMs(1)).toBe(500);
    expect(aiEventPollDelayMs(2)).toBe(1_000);
    expect(aiEventPollDelayMs(3)).toBe(2_000);
    expect(aiEventPollDelayMs(50)).toBe(2_000);
  });

  it("normalizes invalid negative counters", () => {
    expect(aiEventPollDelayMs(-4)).toBe(250);
  });
});
