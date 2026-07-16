import { describe, expect, it } from "vitest";

import { isSameOriginMutation, parseOpaqueSessionId } from "./session-security";

describe("session request security", () => {
  it("accepts only exact same-origin mutations", () => {
    expect(isSameOriginMutation("https://fabric.example/api/account/sessions/id", "https://fabric.example")).toBe(true);
    expect(isSameOriginMutation("https://fabric.example/api/account/sessions/id", "https://evil.example")).toBe(false);
    expect(isSameOriginMutation("https://fabric.example/api/account/sessions/id", null)).toBe(false);
    expect(isSameOriginMutation("https://fabric.example/api/account/sessions/id", "not a url")).toBe(false);
  });

  it("accepts UUID session identifiers and rejects arbitrary paths", () => {
    const sessionId = "9ef1992f-c3ee-4cc4-bbc2-3d3f92262be8";
    expect(parseOpaqueSessionId(sessionId)).toBe(sessionId);
    expect(parseOpaqueSessionId("../current")).toBeNull();
    expect(parseOpaqueSessionId("session-token-secret")).toBeNull();
  });
});
