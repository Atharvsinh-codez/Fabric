CREATE TABLE "workspace_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"subject_user_id" uuid,
	"previous_role" text,
	"next_role" text,
	"previous_owner_id" uuid,
	"next_owner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_audit_events_event_type_check" CHECK ("workspace_audit_events"."event_type" in (
        'board.owner_transferred',
        'board.member_added',
        'board.member_role_changed',
        'board.member_removed',
        'project.member_added',
        'project.member_role_changed',
        'project.member_removed'
      )),
	CONSTRAINT "workspace_audit_events_target_type_check" CHECK ("workspace_audit_events"."target_type" in ('board', 'project')),
	CONSTRAINT "workspace_audit_events_role_check" CHECK (("workspace_audit_events"."previous_role" is null or "workspace_audit_events"."previous_role" in ('editor', 'commenter', 'viewer'))
        and ("workspace_audit_events"."next_role" is null or "workspace_audit_events"."next_role" in ('editor', 'commenter', 'viewer'))),
	CONSTRAINT "workspace_audit_events_transition_check" CHECK ((
        "workspace_audit_events"."event_type" = 'board.owner_transferred'
        and "workspace_audit_events"."target_type" = 'board'
        and "workspace_audit_events"."subject_user_id" is null
        and "workspace_audit_events"."previous_role" is null
        and "workspace_audit_events"."next_role" is null
        and "workspace_audit_events"."previous_owner_id" is not null
        and "workspace_audit_events"."next_owner_id" is not null
        and "workspace_audit_events"."previous_owner_id" <> "workspace_audit_events"."next_owner_id"
      ) or (
        "workspace_audit_events"."event_type" in ('board.member_added', 'project.member_added')
        and "workspace_audit_events"."target_type" = split_part("workspace_audit_events"."event_type", '.', 1)
        and "workspace_audit_events"."subject_user_id" is not null
        and "workspace_audit_events"."previous_role" is null
        and "workspace_audit_events"."next_role" is not null
        and "workspace_audit_events"."previous_owner_id" is null
        and "workspace_audit_events"."next_owner_id" is null
      ) or (
        "workspace_audit_events"."event_type" in ('board.member_role_changed', 'project.member_role_changed')
        and "workspace_audit_events"."target_type" = split_part("workspace_audit_events"."event_type", '.', 1)
        and "workspace_audit_events"."subject_user_id" is not null
        and "workspace_audit_events"."previous_role" is not null
        and "workspace_audit_events"."next_role" is not null
        and "workspace_audit_events"."previous_role" <> "workspace_audit_events"."next_role"
        and "workspace_audit_events"."previous_owner_id" is null
        and "workspace_audit_events"."next_owner_id" is null
      ) or (
        "workspace_audit_events"."event_type" in ('board.member_removed', 'project.member_removed')
        and "workspace_audit_events"."target_type" = split_part("workspace_audit_events"."event_type", '.', 1)
        and "workspace_audit_events"."subject_user_id" is not null
        and "workspace_audit_events"."previous_role" is not null
        and "workspace_audit_events"."next_role" is null
        and "workspace_audit_events"."previous_owner_id" is null
        and "workspace_audit_events"."next_owner_id" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_previous_owner_id_users_id_fk" FOREIGN KEY ("previous_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_audit_events" ADD CONSTRAINT "workspace_audit_events_next_owner_id_users_id_fk" FOREIGN KEY ("next_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_audit_events_workspace_created_idx" ON "workspace_audit_events" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "workspace_audit_events_target_created_idx" ON "workspace_audit_events" USING btree ("workspace_id","target_type","target_id","created_at");