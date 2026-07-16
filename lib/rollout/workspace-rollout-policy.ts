export const WORKSPACE_ROLLOUT_MODES = ["off", "canary", "all"] as const;

export type WorkspaceRolloutMode = (typeof WORKSPACE_ROLLOUT_MODES)[number];

export type WorkspaceRolloutConfiguration = Readonly<{
  mode: WorkspaceRolloutMode;
  canaryWorkspaceIds: readonly string[];
}>;

const MAX_CANARY_WORKSPACES = 200;
const MAX_CANARY_ALLOWLIST_LENGTH = 8_000;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function defaultMode(
  environment: Record<string, string | undefined>,
): WorkspaceRolloutMode {
  const fabricEnvironment = environment.FABRIC_ENV?.trim();
  const production =
    fabricEnvironment === "production" ||
    (!fabricEnvironment && environment.NODE_ENV === "production");
  return production ? "off" : "all";
}

function parseMode(
  environment: Record<string, string | undefined>,
): WorkspaceRolloutMode {
  const configured = environment.FABRIC_WORKSPACE_ROLLOUT_MODE;
  if (configured === undefined || configured === "") {
    return defaultMode(environment);
  }
  if (
    configured === "off" ||
    configured === "canary" ||
    configured === "all"
  ) {
    return configured;
  }
  throw new Error(
    "FABRIC_WORKSPACE_ROLLOUT_MODE must be one of: off, canary, all.",
  );
}

function parseCanaryWorkspaceIds(rawValue: string | undefined): readonly string[] {
  if (rawValue === undefined || rawValue === "") return Object.freeze([]);
  if (rawValue.length > MAX_CANARY_ALLOWLIST_LENGTH) {
    throw new Error("FABRIC_WORKSPACE_CANARY_IDS is too long.");
  }

  const values = rawValue.split(",").map((value) => value.trim());
  if (values.length > MAX_CANARY_WORKSPACES) {
    throw new Error(
      `FABRIC_WORKSPACE_CANARY_IDS supports at most ${MAX_CANARY_WORKSPACES} workspaces.`,
    );
  }
  if (values.some((value) => !CANONICAL_UUID_PATTERN.test(value))) {
    throw new Error(
      "FABRIC_WORKSPACE_CANARY_IDS must contain only comma-separated canonical UUIDs.",
    );
  }
  if (new Set(values).size !== values.length) {
    throw new Error("FABRIC_WORKSPACE_CANARY_IDS cannot contain duplicates.");
  }
  return Object.freeze(values);
}

export function parseWorkspaceRolloutEnvironment(
  environment: Record<string, string | undefined>,
): WorkspaceRolloutConfiguration {
  const mode = parseMode(environment);
  const canaryWorkspaceIds = parseCanaryWorkspaceIds(
    environment.FABRIC_WORKSPACE_CANARY_IDS,
  );
  if (mode === "canary" && canaryWorkspaceIds.length === 0) {
    throw new Error(
      "FABRIC_WORKSPACE_CANARY_IDS must contain at least one workspace when rollout mode is canary.",
    );
  }
  return Object.freeze({ mode, canaryWorkspaceIds });
}

export function workspaceRolloutIncludes(
  configuration: WorkspaceRolloutConfiguration,
  workspaceId: string,
): boolean {
  if (!CANONICAL_UUID_PATTERN.test(workspaceId)) return false;
  if (configuration.mode === "all") return true;
  if (configuration.mode === "off") return false;
  return configuration.canaryWorkspaceIds.includes(workspaceId);
}
