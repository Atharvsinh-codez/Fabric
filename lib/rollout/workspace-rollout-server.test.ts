import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isBoardWorkspaceRolloutEnabled,
  isUserWorkspaceRolloutEnabled,
  isWorkspaceRolloutEnabledForUser,
  requireBoardWorkspaceRollout,
  requireWorkspaceRolloutForUser,
  type WorkspaceRolloutLookups,
} from "./workspace-rollout";

const CANARY_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const BOARD_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";

const canaryEnvironment = {
  FABRIC_ENV: "production",
  FABRIC_WORKSPACE_ROLLOUT_MODE: "canary",
  FABRIC_WORKSPACE_CANARY_IDS: CANARY_ID,
};

function lookups(input: {
  boardWorkspaceId?: string | null;
  userWorkspaceIds?: readonly string[];
}): WorkspaceRolloutLookups {
  return {
    resolveBoardWorkspace: vi
      .fn()
      .mockResolvedValue(input.boardWorkspaceId ?? null),
    listUserWorkspaceIds: vi
      .fn()
      .mockResolvedValue(input.userWorkspaceIds ?? []),
  };
}

describe("server-authoritative workspace rollout", () => {
  it("requires both membership and an enabled exact workspace", async () => {
    await expect(
      isWorkspaceRolloutEnabledForUser(USER_ID, CANARY_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ userWorkspaceIds: [CANARY_ID] }),
      }),
    ).resolves.toBe(true);
    await expect(
      isWorkspaceRolloutEnabledForUser(USER_ID, CANARY_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ userWorkspaceIds: [OTHER_ID] }),
      }),
    ).resolves.toBe(false);
    await expect(
      isWorkspaceRolloutEnabledForUser(USER_ID, OTHER_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ userWorkspaceIds: [OTHER_ID] }),
      }),
    ).resolves.toBe(false);
  });

  it("derives board activation only from authenticated board access", async () => {
    await expect(
      isBoardWorkspaceRolloutEnabled(USER_ID, BOARD_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ boardWorkspaceId: CANARY_ID }),
      }),
    ).resolves.toBe(true);
    await expect(
      isBoardWorkspaceRolloutEnabled(USER_ID, BOARD_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ boardWorkspaceId: null }),
      }),
    ).resolves.toBe(false);
  });

  it("allows a global avatar upload only when one membership is enabled", async () => {
    await expect(
      isUserWorkspaceRolloutEnabled(USER_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ userWorkspaceIds: [OTHER_ID, CANARY_ID] }),
      }),
    ).resolves.toBe(true);
    await expect(
      isUserWorkspaceRolloutEnabled(USER_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ userWorkspaceIds: [OTHER_ID] }),
      }),
    ).resolves.toBe(false);
  });

  it("returns a stable feature-unavailable API error outside rollout", async () => {
    await expect(
      requireWorkspaceRolloutForUser(USER_ID, OTHER_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ userWorkspaceIds: [OTHER_ID] }),
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "feature_not_available",
    });
    await expect(
      requireBoardWorkspaceRollout(USER_ID, BOARD_ID, {
        environment: canaryEnvironment,
        lookups: lookups({ boardWorkspaceId: OTHER_ID }),
      }),
    ).rejects.toMatchObject({
      status: 404,
      code: "feature_not_available",
    });
  });

  it("cannot be enabled by browser-shaped environment variables", async () => {
    await expect(
      isBoardWorkspaceRolloutEnabled(USER_ID, BOARD_ID, {
        environment: {
          FABRIC_ENV: "production",
          NEXT_PUBLIC_FABRIC_WORKSPACE_ROLLOUT_MODE: "all",
        },
        lookups: lookups({ boardWorkspaceId: CANARY_ID }),
      }),
    ).resolves.toBe(false);
  });
});
