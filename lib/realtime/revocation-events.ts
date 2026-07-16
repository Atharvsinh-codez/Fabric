import type {
  RealtimeAccessRole,
  RealtimeRevocationEventType,
  RealtimeRevocationScope,
} from "@/db/schema/collaboration";

export type RealtimeRevocationInsert = Readonly<{
  eventType: RealtimeRevocationEventType;
  scope: RealtimeRevocationScope;
  workspaceId: string;
  projectId?: string;
  boardId?: string;
  documentGenerationId?: string;
  principalId?: string;
  previousRole?: RealtimeAccessRole;
  nextRole?: RealtimeAccessRole;
}>;

const ROLE_STRENGTH: Readonly<Record<RealtimeAccessRole, number>> = {
  owner: 4,
  editor: 3,
  commenter: 2,
  viewer: 1,
};

export function isRealtimeRoleDowngrade(
  previousRole: RealtimeAccessRole,
  nextRole: RealtimeAccessRole,
): boolean {
  return ROLE_STRENGTH[nextRole] < ROLE_STRENGTH[previousRole];
}

export function workspaceMemberRemovedRevocation(input: {
  workspaceId: string;
  principalId: string;
  previousRole: RealtimeAccessRole;
}): RealtimeRevocationInsert {
  return {
    eventType: "workspace.member_removed",
    scope: "workspace",
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    previousRole: input.previousRole,
  };
}

export function workspaceMemberRoleChangedRevocation(input: {
  workspaceId: string;
  principalId: string;
  previousRole: RealtimeAccessRole;
  nextRole: RealtimeAccessRole;
}): RealtimeRevocationInsert | null {
  if (!isRealtimeRoleDowngrade(input.previousRole, input.nextRole)) return null;
  return {
    eventType: "workspace.member_role_changed",
    scope: "workspace",
    workspaceId: input.workspaceId,
    principalId: input.principalId,
    previousRole: input.previousRole,
    nextRole: input.nextRole,
  };
}

export function projectMemberRemovedRevocation(input: {
  workspaceId: string;
  projectId: string;
  principalId: string;
  previousRole: RealtimeAccessRole;
}): RealtimeRevocationInsert {
  return {
    eventType: "project.member_removed",
    scope: "project",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    principalId: input.principalId,
    previousRole: input.previousRole,
  };
}

export function projectMemberRoleChangedRevocation(input: {
  workspaceId: string;
  projectId: string;
  principalId: string;
  previousRole: RealtimeAccessRole;
  nextRole: RealtimeAccessRole;
}): RealtimeRevocationInsert | null {
  if (!isRealtimeRoleDowngrade(input.previousRole, input.nextRole)) return null;
  return {
    eventType: "project.member_role_changed",
    scope: "project",
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    principalId: input.principalId,
    previousRole: input.previousRole,
    nextRole: input.nextRole,
  };
}

export function boardMemberRemovedRevocation(input: {
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  principalId: string;
  previousRole: RealtimeAccessRole;
}): RealtimeRevocationInsert {
  return {
    eventType: "board.member_removed",
    scope: "board",
    workspaceId: input.workspaceId,
    boardId: input.boardId,
    documentGenerationId: input.documentGenerationId,
    principalId: input.principalId,
    previousRole: input.previousRole,
  };
}

export function boardMemberRoleChangedRevocation(input: {
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  principalId: string;
  previousRole: RealtimeAccessRole;
  nextRole: RealtimeAccessRole;
}): RealtimeRevocationInsert | null {
  if (!isRealtimeRoleDowngrade(input.previousRole, input.nextRole)) return null;
  return {
    eventType: "board.member_role_changed",
    scope: "board",
    workspaceId: input.workspaceId,
    boardId: input.boardId,
    documentGenerationId: input.documentGenerationId,
    principalId: input.principalId,
    previousRole: input.previousRole,
    nextRole: input.nextRole,
  };
}

export function boardOwnerChangedRevocation(input: {
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
  previousOwnerId: string;
}): RealtimeRevocationInsert {
  return {
    eventType: "board.owner_changed",
    scope: "board",
    workspaceId: input.workspaceId,
    boardId: input.boardId,
    documentGenerationId: input.documentGenerationId,
    principalId: input.previousOwnerId,
    previousRole: "owner",
  };
}

export function boardArchivedRevocation(input: {
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
}): RealtimeRevocationInsert {
  return {
    eventType: "board.archived",
    scope: "board",
    ...input,
  };
}

export function boardAccessReconfiguredRevocation(input: {
  workspaceId: string;
  boardId: string;
  documentGenerationId: string;
}): RealtimeRevocationInsert {
  return {
    eventType: "board.access_reconfigured",
    scope: "board",
    ...input,
  };
}

export function boardGenerationReplacedRevocation(input: {
  workspaceId: string;
  boardId: string;
  previousDocumentGenerationId: string;
}): RealtimeRevocationInsert {
  return {
    eventType: "board.generation_replaced",
    scope: "board",
    workspaceId: input.workspaceId,
    boardId: input.boardId,
    documentGenerationId: input.previousDocumentGenerationId,
  };
}
