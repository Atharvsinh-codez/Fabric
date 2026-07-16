import { describe, expect, it } from "vitest";

import {
  canAdministerBoard,
  canAdministerProject,
  canTransferBoardOwnership,
  requiredBoardMetadataCapability,
} from "./administration-policy";

describe("tenant-scoped product administration guards", () => {
  it("allows only the board owner or a workspace owner to administer a board", () => {
    expect(
      canAdministerBoard({
        actorId: "board-owner",
        boardOwnerId: "board-owner",
        actorWorkspaceRole: "editor",
      }),
    ).toBe(true);
    expect(
      canAdministerBoard({
        actorId: "workspace-owner",
        boardOwnerId: "board-owner",
        actorWorkspaceRole: "owner",
      }),
    ).toBe(true);
    expect(
      canAdministerBoard({
        actorId: "workspace-editor",
        boardOwnerId: "board-owner",
        actorWorkspaceRole: "editor",
      }),
    ).toBe(false);
  });

  it("requires workspace ownership for project membership administration", () => {
    expect(canAdministerProject("owner")).toBe(true);
    expect(canAdministerProject("editor")).toBe(false);
    expect(canAdministerProject(null)).toBe(false);
  });

  it("rejects ownership transfer when the target is not a current workspace member", () => {
    expect(
      canTransferBoardOwnership({
        actorId: "board-owner",
        boardOwnerId: "board-owner",
        actorWorkspaceRole: "editor",
        targetWorkspaceRole: null,
      }),
    ).toBe(false);
    expect(
      canTransferBoardOwnership({
        actorId: "board-owner",
        boardOwnerId: "board-owner",
        actorWorkspaceRole: "editor",
        targetWorkspaceRole: "viewer",
      }),
    ).toBe(true);
  });

  it("treats project moves as access-policy mutations", () => {
    expect(requiredBoardMetadataCapability({ projectId: "project-2" })).toBe(
      "manage_sharing",
    );
    expect(requiredBoardMetadataCapability({ sharingPolicy: "project" })).toBe(
      "manage_sharing",
    );
    expect(requiredBoardMetadataCapability({ ownerId: "member-2" })).toBe(
      "manage_sharing",
    );
    expect(requiredBoardMetadataCapability({})).toBe("edit_board");
  });
});
