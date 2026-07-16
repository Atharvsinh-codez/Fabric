import type {
  BoardAccessRole,
  WorkspaceAuditTargetType,
  workspaceAuditEvents,
} from "@/db/schema/product";

type AuditEventInsert = typeof workspaceAuditEvents.$inferInsert;

type AuditBase = Readonly<{
  workspaceId: string;
  actorId: string;
  targetId: string;
}>;

type MemberAuditInput = AuditBase &
  Readonly<{
    targetType: WorkspaceAuditTargetType;
    subjectUserId: string;
  }>;

export function boardOwnershipTransferredAuditEvent(
  input: AuditBase &
    Readonly<{
      previousOwnerId: string;
      nextOwnerId: string;
    }>,
): AuditEventInsert {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    eventType: "board.owner_transferred",
    targetType: "board",
    targetId: input.targetId,
    previousOwnerId: input.previousOwnerId,
    nextOwnerId: input.nextOwnerId,
  };
}

export function memberAddedAuditEvent(
  input: MemberAuditInput & Readonly<{ nextRole: BoardAccessRole }>,
): AuditEventInsert {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    eventType: `${input.targetType}.member_added`,
    targetType: input.targetType,
    targetId: input.targetId,
    subjectUserId: input.subjectUserId,
    nextRole: input.nextRole,
  };
}

export function memberRoleChangedAuditEvent(
  input: MemberAuditInput &
    Readonly<{
      previousRole: BoardAccessRole;
      nextRole: BoardAccessRole;
    }>,
): AuditEventInsert {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    eventType: `${input.targetType}.member_role_changed`,
    targetType: input.targetType,
    targetId: input.targetId,
    subjectUserId: input.subjectUserId,
    previousRole: input.previousRole,
    nextRole: input.nextRole,
  };
}

export function memberRemovedAuditEvent(
  input: MemberAuditInput & Readonly<{ previousRole: BoardAccessRole }>,
): AuditEventInsert {
  return {
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    eventType: `${input.targetType}.member_removed`,
    targetType: input.targetType,
    targetId: input.targetId,
    subjectUserId: input.subjectUserId,
    previousRole: input.previousRole,
  };
}
