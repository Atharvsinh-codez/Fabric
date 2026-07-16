import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/clients/web";
import { users } from "@/db/schema/auth";
import { realtimeRevocationOutbox } from "@/db/schema/collaboration";
import {
  boardMemberships,
  boards,
  projectMemberships,
  projects,
  projectUserPreferences,
  workspaceAuditEvents,
  workspaceMemberships,
  type BoardAccessRole,
  type BoardSharingPolicy,
  type ProjectIcon,
} from "@/db/schema/product";
import { resolveUserAvatar } from "@/lib/account/avatar-contracts";
import { userAvatarSelection } from "@/lib/account/avatar-db";
import {
  canAdministerBoard,
  canAdministerProject,
} from "@/lib/boards/administration-policy";
import {
  memberAddedAuditEvent,
  memberRemovedAuditEvent,
  memberRoleChangedAuditEvent,
} from "@/lib/boards/audit-events";
import {
  requireBoardCapability,
  requireWorkspaceCapability,
} from "@/lib/boards/authorization";
import { BoardApiError } from "@/lib/boards/http";
import {
  boardMemberRemovedRevocation,
  boardMemberRoleChangedRevocation,
  projectMemberRemovedRevocation,
  projectMemberRoleChangedRevocation,
} from "@/lib/realtime/revocation-events";

function notFound(): BoardApiError {
  return new BoardApiError(404, "not_found", "The requested resource was not found.");
}

async function requireWorkspaceProject(workspaceId: string, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
    .limit(1);
  if (!project) throw notFound();
  return project;
}

export async function listProjects(input: { userId: string; workspaceId: string }) {
  await requireWorkspaceCapability(input.userId, input.workspaceId, "view");
  return db
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      name: projects.name,
      icon: projects.icon,
      defaultSharingPolicy: projects.defaultSharingPolicy,
      isDefault: projects.isDefault,
      pinnedAt: projectUserPreferences.pinnedAt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(
      projectUserPreferences,
      and(
        eq(projectUserPreferences.projectId, projects.id),
        eq(projectUserPreferences.workspaceId, projects.workspaceId),
        eq(projectUserPreferences.userId, input.userId),
      ),
    )
    .where(eq(projects.workspaceId, input.workspaceId))
    .orderBy(asc(projects.name))
    .then((rows) =>
      rows
        .map((project) => ({ ...project, pinned: Boolean(project.pinnedAt) }))
        .sort((left, right) => Number(right.pinned) - Number(left.pinned)),
    );
}

export async function createProject(input: {
  userId: string;
  workspaceId: string;
  name: string;
  icon: ProjectIcon;
  defaultSharingPolicy: BoardSharingPolicy;
}) {
  await requireWorkspaceCapability(input.userId, input.workspaceId, "create_board");
  return db.transaction(async (transaction) => {
    const [project] = await transaction
      .insert(projects)
      .values({
        workspaceId: input.workspaceId,
        name: input.name,
        icon: input.icon,
        defaultSharingPolicy: input.defaultSharingPolicy,
        createdBy: input.userId,
      })
      .returning();
    if (!project) throw new Error("Project insert returned no row.");
    await transaction.insert(projectMemberships).values({
      workspaceId: input.workspaceId,
      projectId: project.id,
      userId: input.userId,
      role: "editor",
    });
    return { ...project, pinned: false };
  });
}

export async function updateProject(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  name?: string;
  icon?: ProjectIcon;
  defaultSharingPolicy?: BoardSharingPolicy;
}) {
  await requireWorkspaceCapability(input.userId, input.workspaceId, "edit_board");
  const [project] = await db
    .update(projects)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.defaultSharingPolicy !== undefined
        ? { defaultSharingPolicy: input.defaultSharingPolicy }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, input.workspaceId)))
    .returning();
  if (!project) throw notFound();
  return project;
}

export async function updateProjectPreference(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
  pinned: boolean;
}) {
  await requireWorkspaceCapability(input.userId, input.workspaceId, "view");
  await requireWorkspaceProject(input.workspaceId, input.projectId);
  if (!input.pinned) {
    await db
      .delete(projectUserPreferences)
      .where(
        and(
          eq(projectUserPreferences.projectId, input.projectId),
          eq(projectUserPreferences.workspaceId, input.workspaceId),
          eq(projectUserPreferences.userId, input.userId),
        ),
      );
    return { pinned: false };
  }
  const now = new Date();
  await db
    .insert(projectUserPreferences)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      userId: input.userId,
      pinnedAt: now,
    })
    .onConflictDoUpdate({
      target: [projectUserPreferences.projectId, projectUserPreferences.userId],
      set: { pinnedAt: now, updatedAt: now },
    });
  return { pinned: true };
}

export async function listProjectMembers(input: {
  userId: string;
  workspaceId: string;
  projectId: string;
}) {
  await requireWorkspaceCapability(input.userId, input.workspaceId, "view");
  await requireWorkspaceProject(input.workspaceId, input.projectId);
  const members = await db
    .select({
      userId: projectMemberships.userId,
      role: projectMemberships.role,
      name: users.name,
      avatar: userAvatarSelection,
      createdAt: projectMemberships.createdAt,
    })
    .from(projectMemberships)
    .innerJoin(users, eq(users.id, projectMemberships.userId))
    .where(
      and(
        eq(projectMemberships.workspaceId, input.workspaceId),
        eq(projectMemberships.projectId, input.projectId),
      ),
    )
    .orderBy(asc(projectMemberships.createdAt));
  return members.map(({ avatar, ...member }) => ({
    ...member,
    image: resolveUserAvatar(avatar).image,
  }));
}

export async function addProjectMember(input: {
  actorId: string;
  workspaceId: string;
  projectId: string;
  email: string;
  role: BoardAccessRole;
}) {
  await requireWorkspaceCapability(input.actorId, input.workspaceId, "manage_members");
  return db.transaction(async (transaction) => {
    const [project] = await transaction
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, input.workspaceId)))
      .limit(1)
      .for("update");
    if (!project) throw notFound();

    const [member] = await transaction
      .select({
        userId: workspaceMemberships.userId,
        name: users.name,
        avatar: userAvatarSelection,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .where(
        and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          sql`lower(${users.email}) = ${input.email.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (!member) throw notFound();

    const memberIds = Array.from(new Set([input.actorId, member.userId])).sort();
    const lockedWorkspaceMembers = await transaction
      .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          inArray(workspaceMemberships.userId, memberIds),
        ),
      )
      .orderBy(asc(workspaceMemberships.userId))
      .for("update");
    const actorRole =
      lockedWorkspaceMembers.find((candidate) => candidate.userId === input.actorId)?.role ?? null;
    const targetIsMember = lockedWorkspaceMembers.some(
      (candidate) => candidate.userId === member.userId,
    );
    if (!canAdministerProject(actorRole) || !targetIsMember) throw notFound();

    const [created] = await transaction
      .insert(projectMemberships)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        userId: member.userId,
        role: input.role,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new BoardApiError(409, "member_exists", "This project member already exists.");
    }
    await transaction.insert(workspaceAuditEvents).values(
      memberAddedAuditEvent({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        targetType: "project",
        targetId: input.projectId,
        subjectUserId: member.userId,
        nextRole: input.role,
      }),
    );
    return {
      ...created,
      name: member.name,
      image: resolveUserAvatar(member.avatar).image,
    };
  });
}

export async function updateProjectMember(input: {
  actorId: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  role?: BoardAccessRole;
  remove?: boolean;
}) {
  await requireWorkspaceCapability(input.actorId, input.workspaceId, "manage_members");
  return db.transaction(async (transaction) => {
    const [project] = await transaction
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.workspaceId, input.workspaceId)))
      .limit(1)
      .for("update");
    if (!project) throw notFound();

    const memberIds = Array.from(new Set([input.actorId, input.userId])).sort();
    const lockedWorkspaceMembers = await transaction
      .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, input.workspaceId),
          inArray(workspaceMemberships.userId, memberIds),
        ),
      )
      .orderBy(asc(workspaceMemberships.userId))
      .for("update");
    const actorRole =
      lockedWorkspaceMembers.find((member) => member.userId === input.actorId)?.role ?? null;
    const targetIsMember = lockedWorkspaceMembers.some(
      (member) => member.userId === input.userId,
    );
    if (!canAdministerProject(actorRole) || !targetIsMember) throw notFound();

    const [existing] = await transaction
      .select()
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.workspaceId, input.workspaceId),
          eq(projectMemberships.projectId, input.projectId),
          eq(projectMemberships.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) throw notFound();

    if (input.remove) {
      const [removed] = await transaction
        .delete(projectMemberships)
        .where(
          and(
            eq(projectMemberships.workspaceId, input.workspaceId),
            eq(projectMemberships.projectId, input.projectId),
            eq(projectMemberships.userId, input.userId),
          ),
        )
        .returning({ userId: projectMemberships.userId });
      if (!removed) throw notFound();
      await transaction.insert(workspaceAuditEvents).values(
        memberRemovedAuditEvent({
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          targetType: "project",
          targetId: input.projectId,
          subjectUserId: input.userId,
          previousRole: existing.role,
        }),
      );
      await transaction.insert(realtimeRevocationOutbox).values(
        projectMemberRemovedRevocation({
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          principalId: input.userId,
          previousRole: existing.role,
        }),
      );
      return removed;
    }

    if (!input.role) {
      throw new BoardApiError(422, "invalid_request", "A project member role is required.");
    }
    if (existing.role === input.role) return existing;
    const [updated] = await transaction
      .update(projectMemberships)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(projectMemberships.workspaceId, input.workspaceId),
          eq(projectMemberships.projectId, input.projectId),
          eq(projectMemberships.userId, input.userId),
        ),
      )
      .returning();
    if (!updated) throw notFound();
    await transaction.insert(workspaceAuditEvents).values(
      memberRoleChangedAuditEvent({
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        targetType: "project",
        targetId: input.projectId,
        subjectUserId: input.userId,
        previousRole: existing.role,
        nextRole: input.role,
      }),
    );
    const revocation = projectMemberRoleChangedRevocation({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      principalId: input.userId,
      previousRole: existing.role,
      nextRole: input.role,
    });
    if (revocation) {
      await transaction.insert(realtimeRevocationOutbox).values(revocation);
    }
    return updated;
  });
}

export async function listBoardMembers(input: { userId: string; boardId: string }) {
  const { workspaceId } = await requireBoardCapability(input.userId, input.boardId, "view");
  const members = await db
    .select({
      userId: boardMemberships.userId,
      role: boardMemberships.role,
      name: users.name,
      avatar: userAvatarSelection,
      createdAt: boardMemberships.createdAt,
    })
    .from(boardMemberships)
    .innerJoin(users, eq(users.id, boardMemberships.userId))
    .where(
      and(eq(boardMemberships.workspaceId, workspaceId), eq(boardMemberships.boardId, input.boardId)),
    )
    .orderBy(asc(boardMemberships.createdAt));
  return members.map(({ avatar, ...member }) => ({
    ...member,
    image: resolveUserAvatar(avatar).image,
  }));
}

export async function addBoardMember(input: {
  actorId: string;
  boardId: string;
  email: string;
  role: BoardAccessRole;
}) {
  const { workspaceId } = await requireBoardCapability(input.actorId, input.boardId, "manage_sharing");
  return db.transaction(async (transaction) => {
    const [member] = await transaction
      .select({
        userId: workspaceMemberships.userId,
        name: users.name,
        avatar: userAvatarSelection,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          sql`lower(${users.email}) = ${input.email.toLowerCase()}`,
        ),
      )
      .limit(1);
    if (!member) throw notFound();

    const memberIds = Array.from(new Set([input.actorId, member.userId])).sort();
    const lockedWorkspaceMembers = await transaction
      .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          inArray(workspaceMemberships.userId, memberIds),
        ),
      )
      .orderBy(asc(workspaceMemberships.userId))
      .for("update");
    const actorRole =
      lockedWorkspaceMembers.find((candidate) => candidate.userId === input.actorId)?.role ?? null;
    const targetIsMember = lockedWorkspaceMembers.some(
      (candidate) => candidate.userId === member.userId,
    );
    const [board] = await transaction
      .select({
        ownerId: boards.ownerId,
        archivedAt: boards.archivedAt,
        documentGenerationId: boards.documentGenerationId,
      })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), eq(boards.workspaceId, workspaceId)))
      .limit(1)
      .for("update");
    if (
      !board ||
      board.archivedAt ||
      !targetIsMember ||
      !canAdministerBoard({
        actorId: input.actorId,
        boardOwnerId: board.ownerId,
        actorWorkspaceRole: actorRole,
      })
    ) {
      throw notFound();
    }
    if (board.ownerId === member.userId) {
      throw new BoardApiError(409, "owner_membership", "The board owner already has full access.");
    }

    const [created] = await transaction
      .insert(boardMemberships)
      .values({ workspaceId, boardId: input.boardId, userId: member.userId, role: input.role })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      throw new BoardApiError(409, "member_exists", "This board member already exists.");
    }
    await transaction.insert(workspaceAuditEvents).values(
      memberAddedAuditEvent({
        workspaceId,
        actorId: input.actorId,
        targetType: "board",
        targetId: input.boardId,
        subjectUserId: member.userId,
        nextRole: input.role,
      }),
    );
    return {
      ...created,
      name: member.name,
      image: resolveUserAvatar(member.avatar).image,
    };
  });
}

export async function updateBoardMember(input: {
  actorId: string;
  boardId: string;
  userId: string;
  role?: BoardAccessRole;
  remove?: boolean;
}) {
  const { workspaceId } = await requireBoardCapability(
    input.actorId,
    input.boardId,
    "manage_sharing",
  );
  return db.transaction(async (transaction) => {
    const memberIds = Array.from(new Set([input.actorId, input.userId])).sort();
    const lockedWorkspaceMembers = await transaction
      .select({ userId: workspaceMemberships.userId, role: workspaceMemberships.role })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceId, workspaceId),
          inArray(workspaceMemberships.userId, memberIds),
        ),
      )
      .orderBy(asc(workspaceMemberships.userId))
      .for("update");
    const actorRole =
      lockedWorkspaceMembers.find((member) => member.userId === input.actorId)?.role ?? null;
    const targetIsMember = lockedWorkspaceMembers.some(
      (member) => member.userId === input.userId,
    );
    const [board] = await transaction
      .select({
        ownerId: boards.ownerId,
        archivedAt: boards.archivedAt,
        documentGenerationId: boards.documentGenerationId,
      })
      .from(boards)
      .where(and(eq(boards.id, input.boardId), eq(boards.workspaceId, workspaceId)))
      .limit(1)
      .for("update");
    if (
      !board ||
      board.archivedAt ||
      !targetIsMember ||
      !canAdministerBoard({
        actorId: input.actorId,
        boardOwnerId: board.ownerId,
        actorWorkspaceRole: actorRole,
      })
    ) {
      throw notFound();
    }

    const [existing] = await transaction
      .select()
      .from(boardMemberships)
      .where(
        and(
          eq(boardMemberships.workspaceId, workspaceId),
          eq(boardMemberships.boardId, input.boardId),
          eq(boardMemberships.userId, input.userId),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) throw notFound();

    if (input.remove) {
      const [removed] = await transaction
        .delete(boardMemberships)
        .where(
          and(
            eq(boardMemberships.workspaceId, workspaceId),
            eq(boardMemberships.boardId, input.boardId),
            eq(boardMemberships.userId, input.userId),
          ),
        )
        .returning({ userId: boardMemberships.userId });
      if (!removed) throw notFound();
      await transaction.insert(workspaceAuditEvents).values(
        memberRemovedAuditEvent({
          workspaceId,
          actorId: input.actorId,
          targetType: "board",
          targetId: input.boardId,
          subjectUserId: input.userId,
          previousRole: existing.role,
        }),
      );
      await transaction.insert(realtimeRevocationOutbox).values(
        boardMemberRemovedRevocation({
          workspaceId,
          boardId: input.boardId,
          documentGenerationId: board.documentGenerationId,
          principalId: input.userId,
          previousRole: existing.role,
        }),
      );
      return removed;
    }

    if (!input.role) {
      throw new BoardApiError(422, "invalid_request", "A board member role is required.");
    }
    if (existing.role === input.role) return existing;
    const [updated] = await transaction
      .update(boardMemberships)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(boardMemberships.workspaceId, workspaceId),
          eq(boardMemberships.boardId, input.boardId),
          eq(boardMemberships.userId, input.userId),
        ),
      )
      .returning();
    if (!updated) throw notFound();
    await transaction.insert(workspaceAuditEvents).values(
      memberRoleChangedAuditEvent({
        workspaceId,
        actorId: input.actorId,
        targetType: "board",
        targetId: input.boardId,
        subjectUserId: input.userId,
        previousRole: existing.role,
        nextRole: input.role,
      }),
    );
    const revocation = boardMemberRoleChangedRevocation({
      workspaceId,
      boardId: input.boardId,
      documentGenerationId: board.documentGenerationId,
      principalId: input.userId,
      previousRole: existing.role,
      nextRole: input.role,
    });
    if (revocation) {
      await transaction.insert(realtimeRevocationOutbox).values(revocation);
    }
    return updated;
  });
}
