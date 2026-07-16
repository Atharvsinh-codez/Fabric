import { describe, expect, it } from "vitest";

import {
  authoritativePresenceColor,
  PRESENCE_COLORS,
  PRESENCE_FALLBACK_LABEL,
  PRESENCE_UNVERIFIED_COLOR,
  PRESENCE_UNVERIFIED_LABEL,
  resolvePresencePresentation,
  sanitizePresenceDisplayLabel,
} from "./presence-identity";

describe("realtime presence identity", () => {
  it("normalizes unsafe profile text and uses a privacy-safe empty fallback", () => {
    expect(sanitizePresenceDisplayLabel("  Ada\n\u202eLovelace  ")).toBe(
      "Ada Lovelace",
    );
    expect(sanitizePresenceDisplayLabel("\u0000\u202e  ")).toBe(
      PRESENCE_FALLBACK_LABEL,
    );
    expect(sanitizePresenceDisplayLabel("a".repeat(80))).toHaveLength(64);
  });

  it("assigns a stable color from the server palette", () => {
    const principalId = "11111111-1111-4111-8111-111111111111";
    const first = authoritativePresenceColor(principalId);
    expect(first).toBe(authoritativePresenceColor(principalId));
    expect(PRESENCE_COLORS).toContain(first);
  });

  it("keeps client-provided labels and colors inert without the server marker", () => {
    expect(
      resolvePresencePresentation({
        principalId: "11111111-1111-4111-8111-111111111111",
        clientInstanceId: "22222222-2222-4222-8222-222222222222",
        displayLabel: "Workspace owner",
        avatarColor: "#0284c7",
      }),
    ).toEqual({
      authoritative: false,
      color: PRESENCE_UNVERIFIED_COLOR,
      initials: "C",
      label: PRESENCE_UNVERIFIED_LABEL,
    });
  });

  it("renders a marked server identity and supports legacy label fallback", () => {
    const identity = {
      serverAuthoritative: true,
      principalId: "11111111-1111-4111-8111-111111111111",
      clientInstanceId: "22222222-2222-4222-8222-222222222222",
      avatarColor: "#0284c7",
    } as const;
    expect(
      resolvePresencePresentation({ ...identity, displayLabel: "Ada Lovelace" }),
    ).toEqual({
      authoritative: true,
      color: "#0284c7",
      initials: "AL",
      label: "Ada Lovelace",
    });
    expect(resolvePresencePresentation(identity).label).toBe(
      PRESENCE_FALLBACK_LABEL,
    );
  });
});
