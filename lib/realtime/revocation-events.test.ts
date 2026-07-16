import { describe, expect, it } from "vitest";

import {
  boardGenerationReplacedRevocation,
  boardMemberRoleChangedRevocation,
  isRealtimeRoleDowngrade,
  projectMemberRemovedRevocation,
  workspaceMemberRoleChangedRevocation,
} from "./revocation-events";

describe("realtime revocation event factories", () => {
  it("emits role changes only when realtime capabilities can decrease", () => {
    expect(isRealtimeRoleDowngrade("owner", "editor")).toBe(true);
    expect(isRealtimeRoleDowngrade("editor", "commenter")).toBe(true);
    expect(isRealtimeRoleDowngrade("viewer", "editor")).toBe(false);
    expect(
      workspaceMemberRoleChangedRevocation({
        workspaceId: "workspace-1",
        principalId: "user-1",
        previousRole: "viewer",
        nextRole: "editor",
      }),
    ).toBeNull();
    expect(
      boardMemberRoleChangedRevocation({
        workspaceId: "workspace-1",
        boardId: "board-1",
        documentGenerationId: "generation-1",
        principalId: "user-1",
        previousRole: "editor",
        nextRole: "viewer",
      }),
    ).toMatchObject({
      eventType: "board.member_role_changed",
      scope: "board",
      previousRole: "editor",
      nextRole: "viewer",
    });
  });

  it("keeps project removals scoped to the exact principal and project", () => {
    expect(
      projectMemberRemovedRevocation({
        workspaceId: "workspace-1",
        projectId: "project-1",
        principalId: "user-1",
        previousRole: "commenter",
      }),
    ).toEqual({
      eventType: "project.member_removed",
      scope: "project",
      workspaceId: "workspace-1",
      projectId: "project-1",
      principalId: "user-1",
      previousRole: "commenter",
    });
  });

  it("routes a checkpoint restore to the previous immutable room generation", () => {
    expect(
      boardGenerationReplacedRevocation({
        workspaceId: "workspace-1",
        boardId: "board-1",
        previousDocumentGenerationId: "generation-old",
      }),
    ).toEqual({
      eventType: "board.generation_replaced",
      scope: "board",
      workspaceId: "workspace-1",
      boardId: "board-1",
      documentGenerationId: "generation-old",
    });
  });
});
