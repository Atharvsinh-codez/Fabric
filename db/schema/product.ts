import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const WORKSPACE_ROLES = ["owner", "editor", "commenter", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const SHARE_LINK_PERMISSIONS = ["commenter", "viewer"] as const;
export type ShareLinkPermission = (typeof SHARE_LINK_PERMISSIONS)[number];

export const BOARD_ACCESS_ROLES = ["editor", "commenter", "viewer"] as const;
export type BoardAccessRole = (typeof BOARD_ACCESS_ROLES)[number];

export const BOARD_WORKFLOW_STATUSES = [
  "draft",
  "active",
  "review",
  "approved",
] as const;
export type BoardWorkflowStatus = (typeof BOARD_WORKFLOW_STATUSES)[number];

// `archived` is an API/list state derived from `boards.archivedAt`; it is never
// persisted over the board's workflow status.
export const BOARD_STATUSES = [...BOARD_WORKFLOW_STATUSES, "archived"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export const BOARD_SHARING_POLICIES = ["private", "project", "workspace"] as const;
export type BoardSharingPolicy = (typeof BOARD_SHARING_POLICIES)[number];

export const PROJECT_ICONS = [
  "folder",
  "briefcase",
  "compass",
  "layers",
  "sparkles",
  "target",
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];

export const BOARD_COVER_PRESETS = ["sky", "mint", "violet", "sunset", "sand", "slate"] as const;
export type BoardCoverPreset = (typeof BOARD_COVER_PRESETS)[number];
export type BoardCoverPresetMetadata = Readonly<{
  kind: "preset";
  value: BoardCoverPreset;
}>;
export type BoardCoverAssetMetadata = Readonly<{
  kind: "asset";
  assetId: string;
}>;
export type BoardCoverMetadata = BoardCoverPresetMetadata | BoardCoverAssetMetadata;

export const WORKSPACE_AUDIT_EVENT_TYPES = [
  "board.owner_transferred",
  "board.member_added",
  "board.member_role_changed",
  "board.member_removed",
  "project.member_added",
  "project.member_role_changed",
  "project.member_removed",
] as const;
export type WorkspaceAuditEventType = (typeof WORKSPACE_AUDIT_EVENT_TYPES)[number];

export const WORKSPACE_AUDIT_TARGET_TYPES = ["board", "project"] as const;
export type WorkspaceAuditTargetType = (typeof WORKSPACE_AUDIT_TARGET_TYPES)[number];

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type BoardDocument = { [key: string]: JsonValue };

export type CommentAnchor = {
  nodeId?: string;
  x?: number;
  y?: number;
};

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    deletedAt: timestampWithTimezone("deleted_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("workspaces_created_by_idx").on(table.createdBy),
    check(
      "workspaces_name_length_check",
      sql`char_length(${table.name}) between 1 and 120`,
    ),
  ],
);

export const workspaceMemberships = pgTable(
  "workspace_memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "workspace_memberships_workspace_user_pk",
      columns: [table.workspaceId, table.userId],
    }),
    index("workspace_memberships_user_idx").on(table.userId),
    index("workspace_memberships_workspace_role_idx").on(table.workspaceId, table.role),
    check(
      "workspace_memberships_role_check",
      sql`${table.role} in ('owner', 'editor', 'commenter', 'viewer')`,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon").$type<ProjectIcon>().default("folder").notNull(),
    defaultSharingPolicy: text("default_sharing_policy")
      .$type<BoardSharingPolicy>()
      .default("project")
      .notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("projects_id_workspace_unique").on(table.id, table.workspaceId),
    uniqueIndex("projects_workspace_name_unique").on(table.workspaceId, table.name),
    uniqueIndex("projects_workspace_default_unique")
      .on(table.workspaceId)
      .where(sql`${table.isDefault}`),
    index("projects_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    check("projects_name_length_check", sql`char_length(${table.name}) between 1 and 120`),
    check(
      "projects_icon_check",
      sql`${table.icon} in ('folder', 'briefcase', 'compass', 'layers', 'sparkles', 'target')`,
    ),
    check(
      "projects_default_sharing_policy_check",
      sql`${table.defaultSharingPolicy} in ('private', 'project', 'workspace')`,
    ),
  ],
);

export const projectMemberships = pgTable(
  "project_memberships",
  {
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<BoardAccessRole>().notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "project_memberships_project_user_pk",
      columns: [table.projectId, table.userId],
    }),
    foreignKey({
      name: "project_memberships_project_workspace_fk",
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "project_memberships_workspace_user_fk",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
    }).onDelete("cascade"),
    index("project_memberships_workspace_user_idx").on(table.workspaceId, table.userId),
    check(
      "project_memberships_role_check",
      sql`${table.role} in ('editor', 'commenter', 'viewer')`,
    ),
  ],
);

export const boards = pgTable(
  "boards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    ownerId: uuid("owner_id").notNull(),
    title: text("title").notNull(),
    cover: jsonb("cover").$type<BoardCoverMetadata>(),
    status: text("status")
      .$type<BoardWorkflowStatus>()
      .default("active")
      .notNull(),
    sharingPolicy: text("sharing_policy")
      .$type<BoardSharingPolicy>()
      .default("workspace")
      .notNull(),
    document: jsonb("document")
      .$type<BoardDocument>()
      .default(sql`'{"version":1,"nodes":[],"edges":[]}'::jsonb`)
      .notNull(),
    documentGenerationId: uuid("document_generation_id").defaultRandom().notNull(),
    revision: bigint("revision", { mode: "number" }).default(0).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    archivedAt: timestampWithTimezone("archived_at"),
    deletedAt: timestampWithTimezone("deleted_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("boards_id_workspace_unique").on(table.id, table.workspaceId),
    foreignKey({
      name: "boards_project_workspace_fk",
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("restrict"),
    foreignKey({
      name: "boards_owner_workspace_membership_fk",
      columns: [table.workspaceId, table.ownerId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
    }).onDelete("restrict"),
    index("boards_workspace_updated_idx").on(table.workspaceId, table.updatedAt),
    index("boards_workspace_project_updated_idx").on(
      table.workspaceId,
      table.projectId,
      table.updatedAt,
    ),
    index("boards_workspace_status_updated_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    index("boards_owner_updated_idx").on(table.ownerId, table.updatedAt),
    index("boards_created_by_idx").on(table.createdBy),
    check("boards_title_length_check", sql`char_length(${table.title}) between 1 and 160`),
    check("boards_revision_nonnegative_check", sql`${table.revision} >= 0`),
    check(
      "boards_status_check",
      sql`${table.status} in ('draft', 'active', 'review', 'approved')`,
    ),
    check(
      "boards_sharing_policy_check",
      sql`${table.sharingPolicy} in ('private', 'project', 'workspace')`,
    ),
  ],
);

export const boardMemberships = pgTable(
  "board_memberships",
  {
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<BoardAccessRole>().notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "board_memberships_board_user_pk",
      columns: [table.boardId, table.userId],
    }),
    foreignKey({
      name: "board_memberships_board_workspace_fk",
      columns: [table.boardId, table.workspaceId],
      foreignColumns: [boards.id, boards.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "board_memberships_workspace_user_fk",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
    }).onDelete("cascade"),
    index("board_memberships_workspace_user_idx").on(table.workspaceId, table.userId),
    check(
      "board_memberships_role_check",
      sql`${table.role} in ('editor', 'commenter', 'viewer')`,
    ),
  ],
);

export const boardUserPreferences = pgTable(
  "board_user_preferences",
  {
    workspaceId: uuid("workspace_id").notNull(),
    boardId: uuid("board_id").notNull(),
    userId: uuid("user_id").notNull(),
    favoritedAt: timestampWithTimezone("favorited_at"),
    pinnedAt: timestampWithTimezone("pinned_at"),
    lastOpenedAt: timestampWithTimezone("last_opened_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "board_user_preferences_board_user_pk",
      columns: [table.boardId, table.userId],
    }),
    foreignKey({
      name: "board_user_preferences_board_workspace_fk",
      columns: [table.boardId, table.workspaceId],
      foreignColumns: [boards.id, boards.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "board_user_preferences_workspace_user_fk",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
    }).onDelete("cascade"),
    index("board_user_preferences_user_favorite_idx").on(table.userId, table.favoritedAt),
    index("board_user_preferences_user_recent_idx").on(table.userId, table.lastOpenedAt),
  ],
);

export const projectUserPreferences = pgTable(
  "project_user_preferences",
  {
    workspaceId: uuid("workspace_id").notNull(),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id").notNull(),
    pinnedAt: timestampWithTimezone("pinned_at").notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "project_user_preferences_project_user_pk",
      columns: [table.projectId, table.userId],
    }),
    foreignKey({
      name: "project_user_preferences_project_workspace_fk",
      columns: [table.projectId, table.workspaceId],
      foreignColumns: [projects.id, projects.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "project_user_preferences_workspace_user_fk",
      columns: [table.workspaceId, table.userId],
      foreignColumns: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
    }).onDelete("cascade"),
    index("project_user_preferences_user_pinned_idx").on(table.userId, table.pinnedAt),
  ],
);

/**
 * Append-only product administration history. `targetId` is intentionally not
 * a polymorphic foreign key: audit rows must survive later board/project
 * removal. Runtime credentials must not receive UPDATE or DELETE privileges.
 */
export const workspaceAuditEvents = pgTable(
  "workspace_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    eventType: text("event_type").$type<WorkspaceAuditEventType>().notNull(),
    targetType: text("target_type").$type<WorkspaceAuditTargetType>().notNull(),
    targetId: uuid("target_id").notNull(),
    subjectUserId: uuid("subject_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    previousRole: text("previous_role").$type<BoardAccessRole>(),
    nextRole: text("next_role").$type<BoardAccessRole>(),
    previousOwnerId: uuid("previous_owner_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    nextOwnerId: uuid("next_owner_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("workspace_audit_events_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
      table.id,
    ),
    index("workspace_audit_events_target_created_idx").on(
      table.workspaceId,
      table.targetType,
      table.targetId,
      table.createdAt,
    ),
    check(
      "workspace_audit_events_event_type_check",
      sql`${table.eventType} in (
        'board.owner_transferred',
        'board.member_added',
        'board.member_role_changed',
        'board.member_removed',
        'project.member_added',
        'project.member_role_changed',
        'project.member_removed'
      )`,
    ),
    check(
      "workspace_audit_events_target_type_check",
      sql`${table.targetType} in ('board', 'project')`,
    ),
    check(
      "workspace_audit_events_role_check",
      sql`(${table.previousRole} is null or ${table.previousRole} in ('editor', 'commenter', 'viewer'))
        and (${table.nextRole} is null or ${table.nextRole} in ('editor', 'commenter', 'viewer'))`,
    ),
    check(
      "workspace_audit_events_transition_check",
      sql`(
        ${table.eventType} = 'board.owner_transferred'
        and ${table.targetType} = 'board'
        and ${table.subjectUserId} is null
        and ${table.previousRole} is null
        and ${table.nextRole} is null
        and ${table.previousOwnerId} is not null
        and ${table.nextOwnerId} is not null
        and ${table.previousOwnerId} <> ${table.nextOwnerId}
      ) or (
        ${table.eventType} in ('board.member_added', 'project.member_added')
        and ${table.targetType} = split_part(${table.eventType}, '.', 1)
        and ${table.subjectUserId} is not null
        and ${table.previousRole} is null
        and ${table.nextRole} is not null
        and ${table.previousOwnerId} is null
        and ${table.nextOwnerId} is null
      ) or (
        ${table.eventType} in ('board.member_role_changed', 'project.member_role_changed')
        and ${table.targetType} = split_part(${table.eventType}, '.', 1)
        and ${table.subjectUserId} is not null
        and ${table.previousRole} is not null
        and ${table.nextRole} is not null
        and ${table.previousRole} <> ${table.nextRole}
        and ${table.previousOwnerId} is null
        and ${table.nextOwnerId} is null
      ) or (
        ${table.eventType} in ('board.member_removed', 'project.member_removed')
        and ${table.targetType} = split_part(${table.eventType}, '.', 1)
        and ${table.subjectUserId} is not null
        and ${table.previousRole} is not null
        and ${table.nextRole} is null
        and ${table.previousOwnerId} is null
        and ${table.nextOwnerId} is null
      )`,
    ),
  ],
);

export const boardCommentThreads = pgTable(
  "board_comment_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    anchor: jsonb("anchor").$type<CommentAnchor>().default({}).notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestampWithTimezone("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("board_comment_threads_board_created_idx").on(table.boardId, table.createdAt),
    index("board_comment_threads_board_resolved_idx").on(table.boardId, table.resolvedAt),
  ],
);

export const boardComments = pgTable(
  "board_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => boardCommentThreads.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
    deletedAt: timestampWithTimezone("deleted_at"),
  },
  (table) => [
    index("board_comments_thread_created_idx").on(table.threadId, table.createdAt),
    index("board_comments_author_idx").on(table.authorId),
    check(
      "board_comments_body_length_check",
      sql`char_length(${table.body}) between 1 and 4000`,
    ),
  ],
);

export const boardShareLinks = pgTable(
  "board_share_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    permission: text("permission").$type<ShareLinkPermission>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestampWithTimezone("expires_at"),
    revokedAt: timestampWithTimezone("revoked_at"),
    lastUsedAt: timestampWithTimezone("last_used_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("board_share_links_token_hash_unique").on(table.tokenHash),
    index("board_share_links_board_created_idx").on(table.boardId, table.createdAt),
    check(
      "board_share_links_permission_check",
      sql`${table.permission} in ('commenter', 'viewer')`,
    ),
    check(
      "board_share_links_expiry_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`,
    ),
  ],
);
