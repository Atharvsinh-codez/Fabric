import "server-only";

import { eq } from "drizzle-orm";

import { BoardApiError } from "@/lib/boards/http";
import {
  parseWorkspaceRolloutEnvironment,
  workspaceRolloutIncludes,
  type WorkspaceRolloutMode,
} from "@/lib/rollout/workspace-rollout-policy";

export type WorkspaceRolloutLookups = Readonly<{
  resolveBoardWorkspace: (
    userId: string,
    boardId: string,
  ) => Promise<string | null>;
  listUserWorkspaceIds: (userId: string) => Promise<readonly string[]>;
}>;

async function resolveBoardWorkspace(
  userId: string,
  boardId: string,
): Promise<string | null> {
  const { resolveBoardAccess } = await import("@/lib/boards/access");
  return (await resolveBoardAccess(userId, boardId))?.workspaceId ?? null;
}

async function listUserWorkspaceIds(userId: string): Promise<readonly string[]> {
  const [{ db }, { workspaceMemberships }] = await Promise.all([
    import("@/db/clients/web"),
    import("@/db/schema/product"),
  ]);
  const memberships = await db
    .select({ workspaceId: workspaceMemberships.workspaceId })
    .from(workspaceMemberships)
    .where(eq(workspaceMemberships.userId, userId));
  return memberships.map((membership) => membership.workspaceId);
}

const defaultLookups: WorkspaceRolloutLookups = {
  resolveBoardWorkspace,
  listUserWorkspaceIds,
};

type RolloutOptions = Readonly<{
  environment?: Record<string, string | undefined>;
  lookups?: WorkspaceRolloutLookups;
}>;

function configuration(
  environment: Record<string, string | undefined> = process.env,
) {
  return parseWorkspaceRolloutEnvironment(environment);
}

function unavailable(): BoardApiError {
  return new BoardApiError(
    404,
    "feature_not_available",
    "This feature is not available in this workspace yet.",
  );
}

export function getWorkspaceRolloutMode(
  environment: Record<string, string | undefined> = process.env,
): WorkspaceRolloutMode {
  return configuration(environment).mode;
}

export function isWorkspaceRolloutEnabled(
  workspaceId: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return workspaceRolloutIncludes(configuration(environment), workspaceId);
}

export async function isWorkspaceRolloutEnabledForUser(
  userId: string,
  workspaceId: string,
  options: RolloutOptions = {},
): Promise<boolean> {
  const workspaceIds = await (
    options.lookups ?? defaultLookups
  ).listUserWorkspaceIds(userId);
  return (
    workspaceIds.includes(workspaceId) &&
    isWorkspaceRolloutEnabled(workspaceId, options.environment)
  );
}

export async function requireWorkspaceRolloutForUser(
  userId: string,
  workspaceId: string,
  options: RolloutOptions = {},
): Promise<void> {
  if (!(await isWorkspaceRolloutEnabledForUser(userId, workspaceId, options))) {
    throw unavailable();
  }
}

export async function isBoardWorkspaceRolloutEnabled(
  userId: string,
  boardId: string,
  options: RolloutOptions = {},
): Promise<boolean> {
  const workspaceId = await (
    options.lookups ?? defaultLookups
  ).resolveBoardWorkspace(userId, boardId);
  return Boolean(
    workspaceId &&
      isWorkspaceRolloutEnabled(workspaceId, options.environment),
  );
}

export async function requireBoardWorkspaceRollout(
  userId: string,
  boardId: string,
  options: RolloutOptions = {},
): Promise<void> {
  if (!(await isBoardWorkspaceRolloutEnabled(userId, boardId, options))) {
    throw unavailable();
  }
}

export async function isUserWorkspaceRolloutEnabled(
  userId: string,
  options: RolloutOptions = {},
): Promise<boolean> {
  const workspaceIds = await (
    options.lookups ?? defaultLookups
  ).listUserWorkspaceIds(userId);
  const rollout = configuration(options.environment);
  return workspaceIds.some((workspaceId) =>
    workspaceRolloutIncludes(rollout, workspaceId),
  );
}

export async function requireUserWorkspaceRollout(
  userId: string,
  options: RolloutOptions = {},
): Promise<void> {
  if (!(await isUserWorkspaceRolloutEnabled(userId, options))) {
    throw unavailable();
  }
}
