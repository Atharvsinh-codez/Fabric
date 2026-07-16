CREATE TABLE "asset_object_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"reason" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_object_deletions_bucket_check" CHECK ("asset_object_deletions"."bucket" in ('board-assets', 'avatars')),
	CONSTRAINT "asset_object_deletions_reason_check" CHECK (char_length("asset_object_deletions"."reason") between 1 and 64),
	CONSTRAINT "asset_object_deletions_attempts_check" CHECK ("asset_object_deletions"."attempts" between 0 and 100),
	CONSTRAINT "asset_object_deletions_object_key_check" CHECK (char_length("asset_object_deletions"."object_key") between 1 and 900
        and "asset_object_deletions"."object_key" !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//)'),
	CONSTRAINT "asset_object_deletions_lease_shape_check" CHECK (("asset_object_deletions"."lease_owner" is null and "asset_object_deletions"."lease_expires_at" is null)
        or ("asset_object_deletions"."lease_owner" is not null and "asset_object_deletions"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "board_asset_uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"storage_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"tldraw_asset_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"original_name" text,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"r2_object_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_asset_uploads_tldraw_id_check" CHECK ("board_asset_uploads"."tldraw_asset_id" ~ '^asset:[A-Za-z0-9_-]{1,180}$'),
	CONSTRAINT "board_asset_uploads_mime_type_check" CHECK ("board_asset_uploads"."mime_type" in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm')),
	CONSTRAINT "board_asset_uploads_original_name_check" CHECK ("board_asset_uploads"."original_name" is null or char_length("board_asset_uploads"."original_name") between 1 and 180),
	CONSTRAINT "board_asset_uploads_byte_size_check" CHECK ("board_asset_uploads"."byte_size" between 1 and 52428800),
	CONSTRAINT "board_asset_uploads_content_hash_check" CHECK ("board_asset_uploads"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "board_asset_uploads_status_check" CHECK ("board_asset_uploads"."status" in ('pending', 'completed', 'rejected', 'expired')),
	CONSTRAINT "board_asset_uploads_expiry_check" CHECK ("board_asset_uploads"."expires_at" > "board_asset_uploads"."created_at"),
	CONSTRAINT "board_asset_uploads_completion_check" CHECK (("board_asset_uploads"."status" = 'completed' and "board_asset_uploads"."completed_at" is not null)
        or ("board_asset_uploads"."status" <> 'completed' and "board_asset_uploads"."completed_at" is null)),
	CONSTRAINT "board_asset_uploads_r2_object_key_check" CHECK (char_length("board_asset_uploads"."r2_object_key") between 1 and 900
        and "board_asset_uploads"."r2_object_key" !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//)')
);
--> statement-breakpoint
CREATE TABLE "board_memberships" (
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_memberships_board_user_pk" PRIMARY KEY("board_id","user_id"),
	CONSTRAINT "board_memberships_role_check" CHECK ("board_memberships"."role" in ('editor', 'commenter', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "board_user_preferences" (
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"favorited_at" timestamp with time zone,
	"pinned_at" timestamp with time zone,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_user_preferences_board_user_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_memberships_project_user_pk" PRIMARY KEY("project_id","user_id"),
	CONSTRAINT "project_memberships_role_check" CHECK ("project_memberships"."role" in ('editor', 'commenter', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "project_user_preferences" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"pinned_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_user_preferences_project_user_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text DEFAULT 'folder' NOT NULL,
	"default_sharing_policy" text DEFAULT 'project' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_length_check" CHECK (char_length("projects"."name") between 1 and 120),
	CONSTRAINT "projects_icon_check" CHECK ("projects"."icon" in ('folder', 'briefcase', 'compass', 'layers', 'sparkles', 'target')),
	CONSTRAINT "projects_default_sharing_policy_check" CHECK ("projects"."default_sharing_policy" in ('private', 'project', 'workspace'))
);
--> statement-breakpoint
ALTER TABLE "board_assets" DROP CONSTRAINT "board_assets_mime_type_check";--> statement-breakpoint
ALTER TABLE "board_assets" DROP CONSTRAINT "board_assets_byte_size_check";--> statement-breakpoint
ALTER TABLE "board_assets" DROP CONSTRAINT "board_assets_content_size_check";--> statement-breakpoint
ALTER TABLE "board_assets" ALTER COLUMN "content" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "board_assets" ADD COLUMN "storage_state" text DEFAULT 'postgres_only' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_assets" ADD COLUMN "r2_object_key" text;--> statement-breakpoint
ALTER TABLE "board_assets" ADD COLUMN "r2_etag" text;--> statement-breakpoint
ALTER TABLE "board_assets" ADD COLUMN "r2_version" text;--> statement-breakpoint
ALTER TABLE "board_assets" ADD COLUMN "r2_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_object_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_content_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_mime_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_byte_size" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_r2_etag" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_r2_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
-- Add nullable ownership columns first so existing tenants can be backfilled safely.
ALTER TABLE "boards" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "cover" jsonb;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "sharing_policy" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
-- Every existing workspace receives exactly one durable default project.
INSERT INTO "projects" (
	"workspace_id",
	"name",
	"icon",
	"default_sharing_policy",
	"is_default",
	"created_by"
)
SELECT
	"workspaces"."id",
	'Unfiled',
	'folder',
	'workspace',
	true,
	"workspaces"."created_by"
FROM "workspaces";--> statement-breakpoint
-- Preserve the creator as owner when they are still a workspace member. If a
-- former creator was removed, fall back deterministically to a current owner so
-- the new tenant-scoped ownership foreign key can be enforced without leakage.
UPDATE "boards" AS "board"
SET
	"project_id" = "default_project"."id",
	"owner_id" = COALESCE(
		(
			SELECT "creator_membership"."user_id"
			FROM "workspace_memberships" AS "creator_membership"
			WHERE "creator_membership"."workspace_id" = "board"."workspace_id"
				AND "creator_membership"."user_id" = "board"."created_by"
			LIMIT 1
		),
		(
			SELECT "owner_membership"."user_id"
			FROM "workspace_memberships" AS "owner_membership"
			WHERE "owner_membership"."workspace_id" = "board"."workspace_id"
				AND "owner_membership"."role" = 'owner'
			ORDER BY "owner_membership"."created_at", "owner_membership"."user_id"
			LIMIT 1
		)
	),
	"status" = CASE
		WHEN "board"."archived_at" IS NULL THEN 'active'
		ELSE 'archived'
	END,
	"sharing_policy" = 'workspace'
FROM "projects" AS "default_project"
WHERE "default_project"."workspace_id" = "board"."workspace_id"
	AND "default_project"."is_default";--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ALTER COLUMN "owner_id" SET NOT NULL;--> statement-breakpoint
-- Composite tenant foreign keys below require matching unique keys on the
-- referenced tables. Create those keys before adding the foreign keys.
CREATE UNIQUE INDEX "projects_id_workspace_unique" ON "projects" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boards_id_workspace_unique" ON "boards" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "board_asset_uploads" ADD CONSTRAINT "board_asset_uploads_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_asset_uploads" ADD CONSTRAINT "board_asset_uploads_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_memberships" ADD CONSTRAINT "board_memberships_board_workspace_fk" FOREIGN KEY ("board_id","workspace_id") REFERENCES "public"."boards"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_memberships" ADD CONSTRAINT "board_memberships_workspace_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_user_preferences" ADD CONSTRAINT "board_user_preferences_board_workspace_fk" FOREIGN KEY ("board_id","workspace_id") REFERENCES "public"."boards"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_user_preferences" ADD CONSTRAINT "board_user_preferences_workspace_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_workspace_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_user_preferences" ADD CONSTRAINT "project_user_preferences_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_user_preferences" ADD CONSTRAINT "project_user_preferences_workspace_user_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_object_deletions_bucket_key_unique" ON "asset_object_deletions" USING btree ("bucket","object_key");--> statement-breakpoint
CREATE INDEX "asset_object_deletions_claim_idx" ON "asset_object_deletions" USING btree ("completed_at","next_attempt_at","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "board_asset_uploads_r2_object_key_unique" ON "board_asset_uploads" USING btree ("r2_object_key");--> statement-breakpoint
CREATE INDEX "board_asset_uploads_board_status_idx" ON "board_asset_uploads" USING btree ("board_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "board_asset_uploads_uploader_created_idx" ON "board_asset_uploads" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE INDEX "board_memberships_workspace_user_idx" ON "board_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "board_user_preferences_user_favorite_idx" ON "board_user_preferences" USING btree ("user_id","favorited_at");--> statement-breakpoint
CREATE INDEX "board_user_preferences_user_recent_idx" ON "board_user_preferences" USING btree ("user_id","last_opened_at");--> statement-breakpoint
CREATE INDEX "project_memberships_workspace_user_idx" ON "project_memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "project_user_preferences_user_pinned_idx" ON "project_user_preferences" USING btree ("user_id","pinned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_name_unique" ON "projects" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_default_unique" ON "projects" USING btree ("workspace_id") WHERE "projects"."is_default";--> statement-breakpoint
CREATE INDEX "projects_workspace_updated_idx" ON "projects" USING btree ("workspace_id","updated_at");--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_workspace_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_owner_workspace_membership_fk" FOREIGN KEY ("workspace_id","owner_id") REFERENCES "public"."workspace_memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_assets_r2_object_key_unique" ON "board_assets" USING btree ("r2_object_key") WHERE "board_assets"."r2_object_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_avatar_object_key_unique" ON "users" USING btree ("avatar_object_key") WHERE "users"."avatar_object_key" is not null;--> statement-breakpoint
CREATE INDEX "boards_workspace_project_updated_idx" ON "boards" USING btree ("workspace_id","project_id","updated_at");--> statement-breakpoint
CREATE INDEX "boards_workspace_status_updated_idx" ON "boards" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "boards_owner_updated_idx" ON "boards" USING btree ("owner_id","updated_at");--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_storage_state_check" CHECK ("board_assets"."storage_state" in ('postgres_only', 'r2_ready', 'delete_pending'));--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_storage_shape_check" CHECK ((
        "board_assets"."storage_state" = 'postgres_only'
        and "board_assets"."content" is not null
        and "board_assets"."r2_object_key" is null
        and "board_assets"."r2_etag" is null
        and "board_assets"."r2_version" is null
        and "board_assets"."r2_verified_at" is null
      ) or (
        "board_assets"."storage_state" = 'r2_ready'
        and "board_assets"."r2_object_key" is not null
        and "board_assets"."r2_etag" is not null
        and "board_assets"."r2_verified_at" is not null
      ) or (
        "board_assets"."storage_state" = 'delete_pending'
        and "board_assets"."r2_object_key" is not null
      ));--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_r2_object_key_check" CHECK ("board_assets"."r2_object_key" is null or (
        char_length("board_assets"."r2_object_key") between 1 and 900
        and "board_assets"."r2_object_key" !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//)'
      ));--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_mime_type_check" CHECK ("board_assets"."mime_type" in ('image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'));--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_byte_size_check" CHECK ("board_assets"."byte_size" between 1 and 52428800);--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_content_size_check" CHECK ("board_assets"."content" is null or octet_length("board_assets"."content") = "board_assets"."byte_size");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_shape_check" CHECK ((
        "users"."avatar_object_key" is null
        and "users"."avatar_content_hash" is null
        and "users"."avatar_mime_type" is null
        and "users"."avatar_byte_size" is null
        and "users"."avatar_r2_etag" is null
        and "users"."avatar_r2_version" is null
        and "users"."avatar_updated_at" is null
      ) or (
        "users"."avatar_object_key" is not null
        and "users"."avatar_content_hash" is not null
        and "users"."avatar_mime_type" is not null
        and "users"."avatar_byte_size" is not null
        and "users"."avatar_r2_etag" is not null
        and "users"."avatar_updated_at" is not null
      ));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_mime_type_check" CHECK ("users"."avatar_mime_type" is null or "users"."avatar_mime_type" in ('image/png', 'image/jpeg', 'image/gif', 'image/webp'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_byte_size_check" CHECK ("users"."avatar_byte_size" is null or "users"."avatar_byte_size" between 1 and 5242880);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_content_hash_check" CHECK ("users"."avatar_content_hash" is null or "users"."avatar_content_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_object_key_check" CHECK ("users"."avatar_object_key" is null or (
        char_length("users"."avatar_object_key") between 1 and 900
        and "users"."avatar_object_key" !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//)'
      ));--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_status_check" CHECK ("boards"."status" in ('draft', 'active', 'review', 'approved', 'archived'));--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_sharing_policy_check" CHECK ("boards"."sharing_policy" in ('private', 'project', 'workspace'));--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_archive_status_check" CHECK (("boards"."status" = 'archived') = ("boards"."archived_at" is not null));
