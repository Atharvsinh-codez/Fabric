import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { boards, projects, workspaces } from "./product";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return "bytea";
  },
});

export const REALTIME_REVOCATION_EVENT_TYPES = [
  "workspace.member_removed",
  "workspace.member_role_changed",
  "project.member_removed",
  "project.member_role_changed",
  "board.member_removed",
  "board.member_role_changed",
  "board.owner_changed",
  "board.archived",
  "board.access_reconfigured",
  "board.generation_replaced",
] as const;
export type RealtimeRevocationEventType =
  (typeof REALTIME_REVOCATION_EVENT_TYPES)[number];

export const REALTIME_REVOCATION_SCOPES = ["workspace", "project", "board"] as const;
export type RealtimeRevocationScope = (typeof REALTIME_REVOCATION_SCOPES)[number];

export const REALTIME_ACCESS_ROLES = [
  "owner",
  "editor",
  "commenter",
  "viewer",
] as const;
export type RealtimeAccessRole = (typeof REALTIME_ACCESS_ROLES)[number];

export const realtimeDocumentHeads = pgTable(
  "realtime_document_heads",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    documentGenerationId: uuid("document_generation_id").notNull(),
    lastSequence: bigint("last_sequence", { mode: "number" }).default(0).notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "realtime_document_heads_board_generation_pk",
      columns: [table.boardId, table.documentGenerationId],
    }),
    check("realtime_document_heads_sequence_check", sql`${table.lastSequence} >= 0`),
  ],
);

export const realtimeUpdates = pgTable(
  "realtime_updates",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    documentGenerationId: uuid("document_generation_id").notNull(),
    sequence: bigint("sequence", { mode: "number" }).notNull(),
    messageId: uuid("message_id").notNull(),
    clientInstanceId: uuid("client_instance_id").notNull(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    payload: bytea("payload").notNull(),
    payloadHash: text("payload_hash").notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "realtime_updates_board_generation_sequence_pk",
      columns: [table.boardId, table.documentGenerationId, table.sequence],
    }),
    uniqueIndex("realtime_updates_message_id_unique").on(
      table.boardId,
      table.documentGenerationId,
      table.messageId,
    ),
    index("realtime_updates_replay_idx").on(
      table.boardId,
      table.documentGenerationId,
      table.sequence,
    ),
    check("realtime_updates_sequence_check", sql`${table.sequence} > 0`),
    check(
      "realtime_updates_payload_size_check",
      sql`octet_length(${table.payload}) between 1 and 262144`,
    ),
    check(
      "realtime_updates_payload_hash_check",
      sql`char_length(${table.payloadHash}) = 64`,
    ),
  ],
);

export const realtimeTicketRedemptions = pgTable(
  "realtime_ticket_redemptions",
  {
    ticketHmac: text("ticket_hmac").primaryKey(),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    documentGenerationId: uuid("document_generation_id").notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    redeemedAt: timestampWithTimezone("redeemed_at").defaultNow().notNull(),
  },
  (table) => [
    index("realtime_ticket_redemptions_expiry_idx").on(table.expiresAt),
    check(
      "realtime_ticket_redemptions_hmac_check",
      sql`char_length(${table.ticketHmac}) = 64`,
    ),
    check(
      "realtime_ticket_redemptions_expiry_check",
      sql`${table.expiresAt} > ${table.redeemedAt}`,
    ),
  ],
);

export const realtimeTicketMintWindows = pgTable(
  "realtime_ticket_mint_windows",
  {
    principalId: uuid("principal_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    windowStartedAt: timestampWithTimezone("window_started_at").notNull(),
    count: integer("count").default(1).notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "realtime_ticket_mint_windows_principal_board_window_pk",
      columns: [table.principalId, table.boardId, table.windowStartedAt],
    }),
    index("realtime_ticket_mint_windows_expiry_idx").on(table.windowStartedAt),
    check("realtime_ticket_mint_windows_count_check", sql`${table.count} > 0`),
  ],
);

export const realtimeSecurityEvents = pgTable(
  "realtime_security_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: text("code").notNull(),
    principalId: uuid("principal_id").references(() => users.id, { onDelete: "set null" }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "set null" }),
    documentGenerationId: uuid("document_generation_id"),
    messageId: uuid("message_id"),
    details: jsonb("details").$type<Record<string, string | number | boolean>>().default({}).notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("realtime_security_events_code_created_idx").on(table.code, table.createdAt),
    index("realtime_security_events_board_created_idx").on(table.boardId, table.createdAt),
    check(
      "realtime_security_events_code_length_check",
      sql`char_length(${table.code}) between 1 and 64`,
    ),
  ],
);

/**
 * Transactional bridge between permission mutations in Neon and active
 * Durable Object rooms. Delivery is leased and retryable; an event is marked
 * delivered only after the Worker coordinator acknowledges the concrete room
 * page. The event id is the idempotency key used at the room boundary.
 */
export const realtimeRevocationOutbox = pgTable(
  "realtime_revocation_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventType: text("event_type").$type<RealtimeRevocationEventType>().notNull(),
    scope: text("scope").$type<RealtimeRevocationScope>().notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    boardId: uuid("board_id").references(() => boards.id, { onDelete: "cascade" }),
    documentGenerationId: uuid("document_generation_id"),
    principalId: uuid("principal_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    previousRole: text("previous_role").$type<RealtimeAccessRole>(),
    nextRole: text("next_role").$type<RealtimeAccessRole>(),
    cursorBoardId: uuid("cursor_board_id"),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestampWithTimezone("next_attempt_at").defaultNow().notNull(),
    leaseOwner: uuid("lease_owner"),
    leaseExpiresAt: timestampWithTimezone("lease_expires_at"),
    deliveredAt: timestampWithTimezone("delivered_at"),
    lastErrorCode: text("last_error_code"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("realtime_revocation_outbox_dispatch_idx").on(
      table.deliveredAt,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.createdAt,
    ),
    index("realtime_revocation_outbox_workspace_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    check(
      "realtime_revocation_outbox_event_type_check",
      sql`${table.eventType} in (
        'workspace.member_removed',
        'workspace.member_role_changed',
        'project.member_removed',
        'project.member_role_changed',
        'board.member_removed',
        'board.member_role_changed',
        'board.owner_changed',
        'board.archived',
        'board.access_reconfigured',
        'board.generation_replaced'
      )`,
    ),
    check(
      "realtime_revocation_outbox_scope_check",
      sql`${table.scope} in ('workspace', 'project', 'board')`,
    ),
    check(
      "realtime_revocation_outbox_role_check",
      sql`(${table.previousRole} is null or ${table.previousRole} in ('owner', 'editor', 'commenter', 'viewer'))
        and (${table.nextRole} is null or ${table.nextRole} in ('owner', 'editor', 'commenter', 'viewer'))`,
    ),
    check(
      "realtime_revocation_outbox_route_check",
      sql`(
        ${table.scope} = 'workspace'
        and ${table.projectId} is null
        and ${table.boardId} is null
        and ${table.documentGenerationId} is null
        and ${table.principalId} is not null
      ) or (
        ${table.scope} = 'project'
        and ${table.projectId} is not null
        and ${table.boardId} is null
        and ${table.documentGenerationId} is null
        and ${table.principalId} is not null
      ) or (
        ${table.scope} = 'board'
        and ${table.projectId} is null
        and ${table.boardId} is not null
        and ${table.documentGenerationId} is not null
      )`,
    ),
    check(
      "realtime_revocation_outbox_event_shape_check",
      sql`(
        ${table.eventType} in ('workspace.member_removed', 'project.member_removed', 'board.member_removed')
        and ${table.principalId} is not null
        and ${table.previousRole} is not null
        and ${table.nextRole} is null
      ) or (
        ${table.eventType} in ('workspace.member_role_changed', 'project.member_role_changed', 'board.member_role_changed')
        and ${table.principalId} is not null
        and ${table.previousRole} is not null
        and ${table.nextRole} is not null
        and ${table.previousRole} <> ${table.nextRole}
      ) or (
        ${table.eventType} = 'board.owner_changed'
        and ${table.scope} = 'board'
        and ${table.principalId} is not null
        and ${table.previousRole} = 'owner'
        and ${table.nextRole} is null
      ) or (
        ${table.eventType} in ('board.archived', 'board.access_reconfigured', 'board.generation_replaced')
        and ${table.scope} = 'board'
        and ${table.principalId} is null
        and ${table.previousRole} is null
        and ${table.nextRole} is null
      )`,
    ),
    check(
      "realtime_revocation_outbox_event_scope_check",
      sql`(
        ${table.eventType} like 'workspace.%' and ${table.scope} = 'workspace'
      ) or (
        ${table.eventType} like 'project.%' and ${table.scope} = 'project'
      ) or (
        ${table.eventType} like 'board.%' and ${table.scope} = 'board'
      )`,
    ),
    check(
      "realtime_revocation_outbox_attempts_check",
      sql`${table.attempts} >= 0`,
    ),
    check(
      "realtime_revocation_outbox_lease_check",
      sql`(${table.leaseOwner} is null) = (${table.leaseExpiresAt} is null)`,
    ),
    check(
      "realtime_revocation_outbox_error_length_check",
      sql`${table.lastErrorCode} is null or char_length(${table.lastErrorCode}) between 1 and 80`,
    ),
  ],
);
