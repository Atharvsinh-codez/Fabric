CREATE TABLE "realtime_revocation_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"scope" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"board_id" uuid,
	"document_generation_id" uuid,
	"principal_id" uuid,
	"previous_role" text,
	"next_role" text,
	"cursor_board_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_revocation_outbox_event_type_check" CHECK ("realtime_revocation_outbox"."event_type" in (
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
      )),
	CONSTRAINT "realtime_revocation_outbox_scope_check" CHECK ("realtime_revocation_outbox"."scope" in ('workspace', 'project', 'board')),
	CONSTRAINT "realtime_revocation_outbox_role_check" CHECK (("realtime_revocation_outbox"."previous_role" is null or "realtime_revocation_outbox"."previous_role" in ('owner', 'editor', 'commenter', 'viewer'))
        and ("realtime_revocation_outbox"."next_role" is null or "realtime_revocation_outbox"."next_role" in ('owner', 'editor', 'commenter', 'viewer'))),
	CONSTRAINT "realtime_revocation_outbox_route_check" CHECK ((
        "realtime_revocation_outbox"."scope" = 'workspace'
        and "realtime_revocation_outbox"."project_id" is null
        and "realtime_revocation_outbox"."board_id" is null
        and "realtime_revocation_outbox"."document_generation_id" is null
        and "realtime_revocation_outbox"."principal_id" is not null
      ) or (
        "realtime_revocation_outbox"."scope" = 'project'
        and "realtime_revocation_outbox"."project_id" is not null
        and "realtime_revocation_outbox"."board_id" is null
        and "realtime_revocation_outbox"."document_generation_id" is null
        and "realtime_revocation_outbox"."principal_id" is not null
      ) or (
        "realtime_revocation_outbox"."scope" = 'board'
        and "realtime_revocation_outbox"."project_id" is null
        and "realtime_revocation_outbox"."board_id" is not null
        and "realtime_revocation_outbox"."document_generation_id" is not null
      )),
	CONSTRAINT "realtime_revocation_outbox_event_shape_check" CHECK ((
        "realtime_revocation_outbox"."event_type" in ('workspace.member_removed', 'project.member_removed', 'board.member_removed')
        and "realtime_revocation_outbox"."principal_id" is not null
        and "realtime_revocation_outbox"."previous_role" is not null
        and "realtime_revocation_outbox"."next_role" is null
      ) or (
        "realtime_revocation_outbox"."event_type" in ('workspace.member_role_changed', 'project.member_role_changed', 'board.member_role_changed')
        and "realtime_revocation_outbox"."principal_id" is not null
        and "realtime_revocation_outbox"."previous_role" is not null
        and "realtime_revocation_outbox"."next_role" is not null
        and "realtime_revocation_outbox"."previous_role" <> "realtime_revocation_outbox"."next_role"
      ) or (
        "realtime_revocation_outbox"."event_type" = 'board.owner_changed'
        and "realtime_revocation_outbox"."scope" = 'board'
        and "realtime_revocation_outbox"."principal_id" is not null
        and "realtime_revocation_outbox"."previous_role" = 'owner'
        and "realtime_revocation_outbox"."next_role" is null
      ) or (
        "realtime_revocation_outbox"."event_type" in ('board.archived', 'board.access_reconfigured', 'board.generation_replaced')
        and "realtime_revocation_outbox"."scope" = 'board'
        and "realtime_revocation_outbox"."principal_id" is null
        and "realtime_revocation_outbox"."previous_role" is null
        and "realtime_revocation_outbox"."next_role" is null
      )),
	CONSTRAINT "realtime_revocation_outbox_event_scope_check" CHECK ((
        "realtime_revocation_outbox"."event_type" like 'workspace.%' and "realtime_revocation_outbox"."scope" = 'workspace'
      ) or (
        "realtime_revocation_outbox"."event_type" like 'project.%' and "realtime_revocation_outbox"."scope" = 'project'
      ) or (
        "realtime_revocation_outbox"."event_type" like 'board.%' and "realtime_revocation_outbox"."scope" = 'board'
      )),
	CONSTRAINT "realtime_revocation_outbox_attempts_check" CHECK ("realtime_revocation_outbox"."attempts" >= 0),
	CONSTRAINT "realtime_revocation_outbox_lease_check" CHECK (("realtime_revocation_outbox"."lease_owner" is null) = ("realtime_revocation_outbox"."lease_expires_at" is null)),
	CONSTRAINT "realtime_revocation_outbox_error_length_check" CHECK ("realtime_revocation_outbox"."last_error_code" is null or char_length("realtime_revocation_outbox"."last_error_code") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "realtime_revocation_outbox" ADD CONSTRAINT "realtime_revocation_outbox_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_revocation_outbox" ADD CONSTRAINT "realtime_revocation_outbox_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_revocation_outbox" ADD CONSTRAINT "realtime_revocation_outbox_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_revocation_outbox" ADD CONSTRAINT "realtime_revocation_outbox_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_revocation_outbox_dispatch_idx" ON "realtime_revocation_outbox" USING btree ("delivered_at","next_attempt_at","lease_expires_at","created_at");--> statement-breakpoint
CREATE INDEX "realtime_revocation_outbox_workspace_idx" ON "realtime_revocation_outbox" USING btree ("workspace_id","created_at");