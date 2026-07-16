import { describe, expect, it } from "vitest";

import type { BoardAccessSnapshot } from "./access-policy";
import { effectiveBoardAccess } from "./access-policy";

const base: BoardAccessSnapshot = {
  userId: "user-1",
  workspaceId: "workspace-1",
  ownerId: "user-2",
  sharingPolicy: "workspace",
  archivedAt: null,
  workspaceRole: "editor",
  directRole: null,
  projectRole: null,
};

describe("effective board access precedence", () => {
  it("does not allow lower grants to downgrade workspace or board owners", () => {
    expect(
      effectiveBoardAccess({ ...base, workspaceRole: "owner", directRole: "viewer" }),
    ).toMatchObject({ role: "owner", source: "workspace_owner" });
    expect(
      effectiveBoardAccess({ ...base, ownerId: "user-1", directRole: "viewer" }),
    ).toMatchObject({ role: "owner", source: "board_owner" });
  });

  it("lets a direct lower role override inherited project or workspace access", () => {
    expect(
      effectiveBoardAccess({
        ...base,
        sharingPolicy: "project",
        directRole: "viewer",
        projectRole: "editor",
      }),
    ).toMatchObject({ role: "viewer", source: "direct" });
    expect(
      effectiveBoardAccess({ ...base, directRole: "commenter", workspaceRole: "editor" }),
    ).toMatchObject({ role: "commenter", source: "direct" });
  });

  it("uses only the inheritance source selected by the sharing policy", () => {
    expect(
      effectiveBoardAccess({
        ...base,
        sharingPolicy: "project",
        projectRole: "viewer",
        workspaceRole: "editor",
      }),
    ).toMatchObject({ role: "viewer", source: "project" });
    expect(
      effectiveBoardAccess({
        ...base,
        sharingPolicy: "workspace",
        projectRole: "viewer",
      }),
    ).toMatchObject({ role: "editor", source: "workspace" });
  });

  it("does not inherit any access for a private board", () => {
    expect(
      effectiveBoardAccess({
        ...base,
        sharingPolicy: "private",
        workspaceRole: "editor",
        projectRole: "editor",
      }),
    ).toBeNull();
  });

  it.each(["editor", "commenter", "viewer"] as const)(
    "preserves the complete direct %s permission matrix",
    (role) => {
      expect(
        effectiveBoardAccess({
          ...base,
          sharingPolicy: "private",
          workspaceRole: "viewer",
          directRole: role,
          projectRole: "editor",
        }),
      ).toMatchObject({ role, source: "direct", workspaceId: "workspace-1" });
    },
  );

  it.each(["editor", "commenter", "viewer"] as const)(
    "preserves the complete project %s permission matrix only for project sharing",
    (role) => {
      expect(
        effectiveBoardAccess({
          ...base,
          sharingPolicy: "project",
          workspaceRole: "viewer",
          directRole: null,
          projectRole: role,
        }),
      ).toMatchObject({ role, source: "project" });
      expect(
        effectiveBoardAccess({
          ...base,
          sharingPolicy: "private",
          workspaceRole: "viewer",
          directRole: null,
          projectRole: role,
        }),
      ).toBeNull();
    },
  );

  it.each(["editor", "commenter", "viewer"] as const)(
    "preserves the complete workspace %s permission matrix only for workspace sharing",
    (role) => {
      expect(
        effectiveBoardAccess({
          ...base,
          sharingPolicy: "workspace",
          workspaceRole: role,
          directRole: null,
          projectRole: null,
        }),
      ).toMatchObject({ role, source: "workspace" });
      expect(
        effectiveBoardAccess({
          ...base,
          sharingPolicy: "project",
          workspaceRole: role,
          directRole: null,
          projectRole: null,
        }),
      ).toBeNull();
    },
  );

  it("returns no access when every same-tenant grant is absent", () => {
    expect(
      effectiveBoardAccess({
        ...base,
        sharingPolicy: "workspace",
        workspaceRole: null,
        directRole: null,
        projectRole: null,
      }),
    ).toBeNull();
  });
});
