import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("workspace rollout entry-point coverage", () => {
  it("gates R2 grants but preserves the legacy image mutation route", () => {
    expect(
      source("app/api/boards/[boardId]/assets/uploads/route.ts"),
    ).toContain("requireBoardWorkspaceRollout");
    expect(
      source(
        "app/api/boards/[boardId]/assets/uploads/[uploadId]/finalize/route.ts",
      ),
    ).toContain("requireBoardWorkspaceRollout");
    expect(source("app/api/boards/[boardId]/assets/route.ts")).not.toContain(
      "workspace-rollout",
    );
  });

  it("gates new avatar uploads but preserves reads and explicit clearing", () => {
    expect(source("app/api/account/avatar/uploads/route.ts")).toContain(
      "requireUserWorkspaceRollout",
    );
    expect(
      source(
        "app/api/account/avatar/uploads/[uploadId]/finalize/route.ts",
      ),
    ).toContain("requireUserWorkspaceRollout");
    expect(source("app/api/account/avatar/route.ts")).not.toContain(
      "workspace-rollout",
    );
  });

  it("gates the core Track B organization mutation surfaces", () => {
    for (const path of [
      "app/api/boards/[boardId]/preferences/route.ts",
      "app/api/boards/[boardId]/restore/route.ts",
      "app/api/boards/[boardId]/members/route.ts",
      "app/api/boards/[boardId]/members/[userId]/route.ts",
      "app/api/boards/workspaces/[workspaceId]/projects/route.ts",
      "app/api/boards/workspaces/[workspaceId]/projects/[projectId]/route.ts",
      "app/api/boards/workspaces/[workspaceId]/projects/[projectId]/members/route.ts",
      "app/api/boards/workspaces/[workspaceId]/projects/[projectId]/members/[userId]/route.ts",
      "app/api/boards/workspaces/[workspaceId]/projects/[projectId]/preferences/route.ts",
    ]) {
      expect(source(path), path).toContain("workspace-rollout");
    }
    expect(source("app/api/boards/route.ts")).toContain(
      "requireWorkspaceRolloutForUser",
    );
    expect(source("app/api/boards/[boardId]/route.ts")).toContain(
      "requireBoardWorkspaceRollout",
    );
  });
});
