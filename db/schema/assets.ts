import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./auth";
import { boards } from "./product";

const timestampWithTimezone = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

/**
 * Private board-scoped binaries used by tldraw asset records. The database is
 * intentionally the first production storage backend so uploads share Fabric's
 * existing authorization and backup boundary; this can later move behind an
 * object-store adapter without changing persisted tldraw records.
 */
export const boardAssets = pgTable(
  "board_assets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    tldrawAssetId: text("tldraw_asset_id").notNull(),
    mimeType: text("mime_type").notNull(),
    originalName: text("original_name"),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash").notNull(),
    content: bytea("content"),
    storageState: text("storage_state")
      .$type<"postgres_only" | "r2_ready" | "delete_pending">()
      .default("postgres_only")
      .notNull(),
    r2ObjectKey: text("r2_object_key"),
    r2Etag: text("r2_etag"),
    r2Version: text("r2_version"),
    r2VerifiedAt: timestampWithTimezone("r2_verified_at"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("board_assets_board_tldraw_id_unique").on(
      table.boardId,
      table.tldrawAssetId,
    ),
    index("board_assets_board_created_idx").on(table.boardId, table.createdAt),
    index("board_assets_uploader_created_idx").on(table.uploadedBy, table.createdAt),
    uniqueIndex("board_assets_r2_object_key_unique")
      .on(table.r2ObjectKey)
      .where(sql`${table.r2ObjectKey} is not null`),
    check(
      "board_assets_tldraw_id_check",
      sql`${table.tldrawAssetId} ~ '^asset:[A-Za-z0-9_-]{1,180}$'`,
    ),
    check(
      "board_assets_mime_type_check",
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm')`,
    ),
    check(
      "board_assets_original_name_check",
      sql`${table.originalName} is null or char_length(${table.originalName}) between 1 and 180`,
    ),
    check(
      "board_assets_byte_size_check",
      sql`${table.byteSize} between 1 and 52428800`,
    ),
    check(
      "board_assets_content_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "board_assets_content_size_check",
      sql`${table.content} is null or octet_length(${table.content}) = ${table.byteSize}`,
    ),
    check(
      "board_assets_storage_state_check",
      sql`${table.storageState} in ('postgres_only', 'r2_ready', 'delete_pending')`,
    ),
    check(
      "board_assets_storage_shape_check",
      sql`(
        ${table.storageState} = 'postgres_only'
        and ${table.content} is not null
        and ${table.r2ObjectKey} is null
        and ${table.r2Etag} is null
        and ${table.r2Version} is null
        and ${table.r2VerifiedAt} is null
      ) or (
        ${table.storageState} = 'r2_ready'
        and ${table.r2ObjectKey} is not null
        and ${table.r2Etag} is not null
        and ${table.r2VerifiedAt} is not null
      ) or (
        ${table.storageState} = 'delete_pending'
        and ${table.r2ObjectKey} is not null
      )`,
    ),
    check(
      "board_assets_r2_object_key_check",
      sql`${table.r2ObjectKey} is null or (
        char_length(${table.r2ObjectKey}) between 1 and 900
        and ${table.r2ObjectKey} !~ '(^/|\\\\|(^|/)\\.{1,2}(/|$)|//)'
      )`,
    ),
  ],
);

/**
 * Short-lived reservations for direct browser uploads. A replacement never
 * overwrites the currently readable asset until its private R2 object has been
 * verified and the final board_assets pointer is swapped transactionally.
 */
export const boardAssetUploads = pgTable(
  "board_asset_uploads",
  {
    id: uuid("id").primaryKey(),
    storageId: uuid("storage_id").notNull(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),
    tldrawAssetId: text("tldraw_asset_id").notNull(),
    mimeType: text("mime_type").notNull(),
    originalName: text("original_name"),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash").notNull(),
    r2ObjectKey: text("r2_object_key").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"pending" | "completed" | "rejected" | "expired">()
      .default("pending")
      .notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    completedAt: timestampWithTimezone("completed_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("board_asset_uploads_r2_object_key_unique").on(table.r2ObjectKey),
    index("board_asset_uploads_board_status_idx").on(
      table.boardId,
      table.status,
      table.expiresAt,
    ),
    index("board_asset_uploads_uploader_created_idx").on(
      table.uploadedBy,
      table.createdAt,
    ),
    check(
      "board_asset_uploads_tldraw_id_check",
      sql`${table.tldrawAssetId} ~ '^asset:[A-Za-z0-9_-]{1,180}$'`,
    ),
    check(
      "board_asset_uploads_mime_type_check",
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm')`,
    ),
    check(
      "board_asset_uploads_original_name_check",
      sql`${table.originalName} is null or char_length(${table.originalName}) between 1 and 180`,
    ),
    check(
      "board_asset_uploads_byte_size_check",
      sql`${table.byteSize} between 1 and 52428800`,
    ),
    check(
      "board_asset_uploads_content_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "board_asset_uploads_status_check",
      sql`${table.status} in ('pending', 'completed', 'rejected', 'expired')`,
    ),
    check(
      "board_asset_uploads_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "board_asset_uploads_completion_check",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null)
        or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
    check(
      "board_asset_uploads_r2_object_key_check",
      sql`char_length(${table.r2ObjectKey}) between 1 and 900
        and ${table.r2ObjectKey} !~ '(^/|\\\\|(^|/)\\.{1,2}(/|$)|//)'`,
    ),
  ],
);

/**
 * Retry-safe, client-keyed grants for custom avatar uploads. The user row is
 * locked while inserting these reservations so the generous outstanding cap
 * is a concurrency bound rather than a request-rate throttle.
 */
export const avatarUploadReservations = pgTable(
  "avatar_upload_reservations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentHash: text("content_hash").notNull(),
    r2ObjectKey: text("r2_object_key").notNull(),
    status: text("status")
      .$type<"pending" | "completed" | "rejected" | "expired">()
      .default("pending")
      .notNull(),
    expiresAt: timestampWithTimezone("expires_at").notNull(),
    completedAt: timestampWithTimezone("completed_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("avatar_upload_reservations_r2_object_key_unique").on(
      table.r2ObjectKey,
    ),
    index("avatar_upload_reservations_user_status_expiry_idx").on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
    check(
      "avatar_upload_reservations_mime_type_check",
      sql`${table.mimeType} in ('image/png', 'image/jpeg', 'image/webp')`,
    ),
    check(
      "avatar_upload_reservations_byte_size_check",
      sql`${table.byteSize} between 1 and 5242880`,
    ),
    check(
      "avatar_upload_reservations_content_hash_check",
      sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "avatar_upload_reservations_status_check",
      sql`${table.status} in ('pending', 'completed', 'rejected', 'expired')`,
    ),
    check(
      "avatar_upload_reservations_expiry_check",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "avatar_upload_reservations_completion_check",
      sql`(${table.status} = 'completed' and ${table.completedAt} is not null)
        or (${table.status} <> 'completed' and ${table.completedAt} is null)`,
    ),
    check(
      "avatar_upload_reservations_r2_object_key_check",
      sql`char_length(${table.r2ObjectKey}) between 1 and 900
        and ${table.r2ObjectKey} !~ '(^/|\\\\|(^|/)\\.{1,2}(/|$)|//)'`,
    ),
  ],
);

/** Durable bridge for PostgreSQL/R2 deletes, which cannot share a transaction. */
export const assetObjectDeletions = pgTable(
  "asset_object_deletions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bucket: text("bucket").$type<"board-assets" | "avatars">().notNull(),
    objectKey: text("object_key").notNull(),
    reason: text("reason").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    nextAttemptAt: timestampWithTimezone("next_attempt_at").defaultNow().notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestampWithTimezone("lease_expires_at"),
    lastErrorCode: text("last_error_code"),
    completedAt: timestampWithTimezone("completed_at"),
    createdAt: timestampWithTimezone("created_at").defaultNow().notNull(),
    updatedAt: timestampWithTimezone("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("asset_object_deletions_bucket_key_unique").on(
      table.bucket,
      table.objectKey,
    ),
    index("asset_object_deletions_claim_idx").on(
      table.completedAt,
      table.nextAttemptAt,
      table.leaseExpiresAt,
    ),
    check(
      "asset_object_deletions_bucket_check",
      sql`${table.bucket} in ('board-assets', 'avatars')`,
    ),
    check(
      "asset_object_deletions_reason_check",
      sql`char_length(${table.reason}) between 1 and 64`,
    ),
    check(
      "asset_object_deletions_attempts_check",
      sql`${table.attempts} between 0 and 100`,
    ),
    check(
      "asset_object_deletions_object_key_check",
      sql`char_length(${table.objectKey}) between 1 and 900
        and ${table.objectKey} !~ '(^/|\\\\|(^|/)\\.{1,2}(/|$)|//)'`,
    ),
    check(
      "asset_object_deletions_lease_shape_check",
      sql`(${table.leaseOwner} is null and ${table.leaseExpiresAt} is null)
        or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
  ],
);
