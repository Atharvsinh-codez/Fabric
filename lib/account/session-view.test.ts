import { describe, expect, it } from "vitest";

import { buildAccountSessionList, type StoredAccountSession } from "./session-view";

const sessions: StoredAccountSession[] = [
  {
    id: "9ef1992f-c3ee-4cc4-bbc2-3d3f92262be8",
    sessionToken: "current-secret-session-token",
    expires: new Date("2026-08-01T10:00:00.000Z"),
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    lastSeenAt: new Date("2026-07-13T10:00:00.000Z"),
    deviceLabel: "Chrome on Windows",
    userAgentFamily: null,
  },
  {
    id: "246f8ee9-2d32-46ad-b2a4-c59e5234b95b",
    sessionToken: "another-secret-session-token",
    expires: new Date("2026-08-02T10:00:00.000Z"),
    createdAt: null,
    lastSeenAt: null,
    deviceLabel: null,
    userAgentFamily: null,
  },
];

describe("buildAccountSessionList", () => {
  it("marks only the matching session and never serializes tokens", () => {
    const result = buildAccountSessionList(sessions, ["current-secret-session-token"]);

    expect(result.currentSessionVerified).toBe(true);
    expect(result.sessions.map((session) => session.current)).toEqual([true, false]);
    expect(result.sessions[1].deviceLabel).toBe("Web browser");
    expect(JSON.stringify(result)).not.toContain("secret-session-token");
    expect(result.sessions[0]).not.toHaveProperty("sessionToken");
  });

  it("fails closed when no cookie token matches an owned session", () => {
    const result = buildAccountSessionList(sessions, ["unknown-session-token"]);

    expect(result.currentSessionVerified).toBe(false);
    expect(result.sessions.every((session) => !session.current)).toBe(true);
  });
});
