import { describe, expect, it } from "vitest";

import {
  parseWorkspaceRolloutEnvironment,
  workspaceRolloutIncludes,
} from "./workspace-rollout-policy";

const CANARY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function isWorkspaceRolloutEnabled(
  workspaceId: string,
  environment: Record<string, string | undefined>,
): boolean {
  return workspaceRolloutIncludes(
    parseWorkspaceRolloutEnvironment(environment),
    workspaceId,
  );
}

describe("workspace rollout environment", () => {
  it("fails closed by default in production", () => {
    expect(
      parseWorkspaceRolloutEnvironment({ FABRIC_ENV: "production" }),
    ).toEqual({ mode: "off", canaryWorkspaceIds: [] });
    expect(
      parseWorkspaceRolloutEnvironment({ NODE_ENV: "production" }),
    ).toEqual({ mode: "off", canaryWorkspaceIds: [] });
    expect(
      isWorkspaceRolloutEnabled(CANARY_ID, { FABRIC_ENV: "production" }),
    ).toBe(false);
  });

  it("keeps local, preview, staging, and test development ergonomic", () => {
    for (const FABRIC_ENV of ["local", "preview", "staging"] as const) {
      expect(
        isWorkspaceRolloutEnabled(CANARY_ID, {
          NODE_ENV: "production",
          FABRIC_ENV,
        }),
      ).toBe(true);
    }
    expect(
      isWorkspaceRolloutEnabled(CANARY_ID, { NODE_ENV: "test" }),
    ).toBe(true);
  });

  it("supports explicit off and all modes", () => {
    expect(
      isWorkspaceRolloutEnabled(CANARY_ID, {
        FABRIC_ENV: "local",
        FABRIC_WORKSPACE_ROLLOUT_MODE: "off",
      }),
    ).toBe(false);
    expect(
      isWorkspaceRolloutEnabled(CANARY_ID, {
        FABRIC_ENV: "production",
        FABRIC_WORKSPACE_ROLLOUT_MODE: "all",
      }),
    ).toBe(true);
  });

  it("enables only exact allowlisted workspaces in canary mode", () => {
    const environment = {
      FABRIC_ENV: "production",
      FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
      FABRIC_WORKSPACE_CANARY_IDS: `${CANARY_ID}, ${OTHER_ID}`,
      NEXT_PUBLIC_FABRIC_WORKSPACE_ROLLOUT_MODE: "all",
    };
    expect(isWorkspaceRolloutEnabled(CANARY_ID, environment)).toBe(true);
    expect(isWorkspaceRolloutEnabled(OTHER_ID, environment)).toBe(true);
    expect(
      isWorkspaceRolloutEnabled(
        "33333333-3333-4333-8333-333333333333",
        environment,
      ),
    ).toBe(false);
  });

  it.each([
    [{ FABRIC_WORKSPACE_ROLLOUT_MODE: "enabled" }],
    [
      {
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS: "",
      },
    ],
    [
      {
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS: `${CANARY_ID},`,
      },
    ],
    [
      {
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS:
          "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
    ],
    [
      {
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS: `${CANARY_ID},${CANARY_ID}`,
      },
    ],
    [
      {
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS: "11111111-1111-0111-8111-111111111111",
      },
    ],
  ])("rejects malformed or ambiguous rollout configuration", (environment) => {
    expect(() => parseWorkspaceRolloutEnvironment(environment)).toThrow();
  });

  it("returns false for an invalid runtime workspace id instead of matching loosely", () => {
    expect(
      isWorkspaceRolloutEnabled(`${CANARY_ID}-suffix`, {
        FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
        FABRIC_WORKSPACE_CANARY_IDS: CANARY_ID,
      }),
    ).toBe(false);
  });
});
