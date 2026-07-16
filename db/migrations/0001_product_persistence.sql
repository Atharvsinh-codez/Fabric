CREATE TABLE "board_comment_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"anchor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "board_comments_body_length_check" CHECK (char_length("board_comments"."body") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "board_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"permission" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_share_links_permission_check" CHECK ("board_share_links"."permission" in ('commenter', 'viewer')),
	CONSTRAINT "board_share_links_expiry_check" CHECK ("board_share_links"."expires_at" is null or "board_share_links"."expires_at" > "board_share_links"."created_at")
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"document" jsonb DEFAULT '{"version":1,"nodes":[],"edges":[]}'::jsonb NOT NULL,
	"document_generation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "boards_title_length_check" CHECK (char_length("boards"."title") between 1 and 160),
	CONSTRAINT "boards_revision_nonnegative_check" CHECK ("boards"."revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_memberships" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_memberships_workspace_user_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_memberships_role_check" CHECK ("workspace_memberships"."role" in ('owner', 'editor', 'commenter', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_name_length_check" CHECK (char_length("workspaces"."name") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "board_comment_threads" ADD CONSTRAINT "board_comment_threads_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_comment_threads" ADD CONSTRAINT "board_comment_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_comment_threads" ADD CONSTRAINT "board_comment_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_thread_id_board_comment_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."board_comment_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_comments" ADD CONSTRAINT "board_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_share_links" ADD CONSTRAINT "board_share_links_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_share_links" ADD CONSTRAINT "board_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_comment_threads_board_created_idx" ON "board_comment_threads" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "board_comment_threads_board_resolved_idx" ON "board_comment_threads" USING btree ("board_id","resolved_at");--> statement-breakpoint
CREATE INDEX "board_comments_thread_created_idx" ON "board_comments" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "board_comments_author_idx" ON "board_comments" USING btree ("author_id");--> statement-breakpoint
CREATE UNIQUE INDEX "board_share_links_token_hash_unique" ON "board_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "board_share_links_board_created_idx" ON "board_share_links" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "boards_workspace_updated_idx" ON "boards" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "boards_created_by_idx" ON "boards" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "workspace_memberships_user_idx" ON "workspace_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_memberships_workspace_role_idx" ON "workspace_memberships" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "workspaces_created_by_idx" ON "workspaces" USING btree ("created_by");