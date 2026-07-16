import type { AdapterAccountType } from "next-auth/adapters";
import { sql } from "drizzle-orm";
import {
  check,
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

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name"),
    email: text("email"),
    emailVerified: timestampWithTimezone("email_verified"),
    image: text("image"),
    avatarObjectKey: text("avatar_object_key"),
    avatarContentHash: text("avatar_content_hash"),
    avatarMimeType: text("avatar_mime_type"),
    avatarByteSize: integer("avatar_byte_size"),
    avatarR2Etag: text("avatar_r2_etag"),
    avatarR2Version: text("avatar_r2_version"),
    avatarUpdatedAt: timestampWithTimezone("avatar_updated_at"),
    suspendedAt: timestampWithTimezone("suspended_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    uniqueIndex("users_avatar_object_key_unique")
      .on(table.avatarObjectKey)
      .where(sql`${table.avatarObjectKey} is not null`),
    check(
      "users_avatar_shape_check",
      sql`(
        ${table.avatarObjectKey} is null
        and ${table.avatarContentHash} is null
        and ${table.avatarMimeType} is null
        and ${table.avatarByteSize} is null
        and ${table.avatarR2Etag} is null
        and ${table.avatarR2Version} is null
        and ${table.avatarUpdatedAt} is null
      ) or (
        ${table.avatarObjectKey} is not null
        and ${table.avatarContentHash} is not null
        and ${table.avatarMimeType} is not null
        and ${table.avatarByteSize} is not null
        and ${table.avatarR2Etag} is not null
        and ${table.avatarUpdatedAt} is not null
      )`,
    ),
    check(
      "users_avatar_mime_type_check",
      sql`${table.avatarMimeType} is null or ${table.avatarMimeType} in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')`,
    ),
    check(
      "users_avatar_byte_size_check",
      sql`${table.avatarByteSize} is null or ${table.avatarByteSize} between 1 and 5242880`,
    ),
    check(
      "users_avatar_content_hash_check",
      sql`${table.avatarContentHash} is null or ${table.avatarContentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "users_avatar_object_key_check",
      sql`${table.avatarObjectKey} is null or (
        char_length(${table.avatarObjectKey}) between 1 and 900
        and ${table.avatarObjectKey} !~ '(^/|\\\\|(^|/)\\.{1,2}(/|$)|//)'
      )`,
    ),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "accounts_provider_provider_account_id_pk",
      columns: [table.provider, table.providerAccountId],
    }),
    index("accounts_user_id_idx").on(table.userId),
    check(
      "accounts_identity_only_tokens_redacted",
      sql`${table.access_token} is null and ${table.refresh_token} is null and ${table.id_token} is null`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().notNull(),
    sessionToken: text("session_token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestampWithTimezone("expires").notNull(),
  },
  (table) => [
    uniqueIndex("sessions_id_unique").on(table.id),
    index("sessions_user_id_expires_idx").on(table.userId, table.expires),
  ],
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestampWithTimezone("expires").notNull(),
  },
  (table) => [
    primaryKey({
      name: "verification_tokens_identifier_token_pk",
      columns: [table.identifier, table.token],
    }),
    index("verification_tokens_expires_idx").on(table.expires),
  ],
);

export const sessionMetadata = pgTable(
  "session_metadata",
  {
    sessionId: uuid("session_id")
      .primaryKey()
      .references(() => sessions.id, { onDelete: "cascade" }),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    lastSeenAt: timestampWithTimezone("last_seen_at").defaultNow().notNull(),
    deviceLabel: text("device_label"),
    userAgentFamily: text("user_agent_family"),
    ipHash: text("ip_hash"),
    reauthenticatedAt: timestampWithTimezone("reauthenticated_at"),
    reauthenticationMethod: text("reauthentication_method"),
    revokedAt: timestampWithTimezone("revoked_at"),
    revocationReason: text("revocation_reason"),
  },
  (table) => [index("session_metadata_last_seen_at_idx").on(table.lastSeenAt)],
);

export const accountLinkIntents = pgTable(
  "account_link_intents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    provider: text("provider").$type<"google" | "github">().notNull(),
    stateHash: text("state_hash").notNull(),
    nonceHash: text("nonce_hash").notNull(),
    status: text("status")
      .$type<"pending" | "consumed" | "expired" | "cancelled">()
      .default("pending")
      .notNull(),
    providerAccountId: text("provider_account_id"),
    providerEmail: text("provider_email"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    consumedAt: timestampWithTimezone("consumed_at"),
  },
  (table) => [
    uniqueIndex("account_link_intents_state_hash_unique").on(table.stateHash),
    uniqueIndex("account_link_intents_nonce_hash_unique").on(table.nonceHash),
    index("account_link_intents_user_status_idx").on(table.userId, table.status),
    index("account_link_intents_expires_at_idx").on(table.expiresAt),
    check("account_link_intents_provider_check", sql`${table.provider} in ('google', 'github')`),
    check(
      "account_link_intents_status_check",
      sql`${table.status} in ('pending', 'consumed', 'expired', 'cancelled')`,
    ),
    check("account_link_intents_expiry_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const accountSecurityEvents = pgTable(
  "account_security_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    provider: text("provider"),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    userAgentFamily: text("user_agent_family"),
    details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("account_security_events_user_created_at_idx").on(table.userId, table.createdAt),
    index("account_security_events_event_type_idx").on(table.eventType),
  ],
);
