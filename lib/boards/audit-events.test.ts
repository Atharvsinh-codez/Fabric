import { describe, expect, it } from "vitest";

import {
  boardOwnershipTransferredAuditEvent,
  memberAddedAuditEvent,
  memberRemovedAuditEvent,
  memberRoleChangedAuditEvent,
} from "./audit-events";

const base = {
  workspaceId: "workspace-1",
  actorId: "actor-1",
  targetId: "target-1",
} as const;

describe("workspace product audit events", () => {
  it("records an ownership transition without storing unrelated membership fields", () => {
    expect(
      boardOwnershipTransferredAuditEvent({
        ...base,
        previousOwnerId: "owner-1",
        nextOwnerId: "owner-2",
      }),
    ).toEqual({
      ...base,
      eventType: "board.owner_transferred",
      targetType: "board",
      previousOwnerId: "owner-1",
      nextOwnerId: "owner-2",
    });
  });

  it("records complete project membership add, role-change, and removal transitions", () => {
    const memberBase = {
      ...base,
      targetType: "project" as const,
      subjectUserId: "member-1",
    };
    expect(memberAddedAuditEvent({ ...memberBase, nextRole: "viewer" })).toMatchObject({
      eventType: "project.member_added",
      nextRole: "viewer",
    });
    expect(
      memberRoleChangedAuditEvent({
        ...memberBase,
        previousRole: "viewer",
        nextRole: "editor",
      }),
    ).toMatchObject({
      eventType: "project.member_role_changed",
      previousRole: "viewer",
      nextRole: "editor",
    });
    expect(memberRemovedAuditEvent({ ...memberBase, previousRole: "editor" })).toMatchObject({
      eventType: "project.member_removed",
      previousRole: "editor",
    });
  });

  it("uses the same tenant-scoped shape for direct board membership events", () => {
    expect(
      memberAddedAuditEvent({
        ...base,
        targetType: "board",
        subjectUserId: "member-2",
        nextRole: "commenter",
      }),
    ).toEqual({
      ...base,
      eventType: "board.member_added",
      targetType: "board",
      subjectUserId: "member-2",
      nextRole: "commenter",
    });
  });
});
