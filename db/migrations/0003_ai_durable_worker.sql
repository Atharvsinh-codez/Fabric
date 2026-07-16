CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_jobs_attempts_check" CHECK ("ai_jobs"."attempts" >= 0),
	CONSTRAINT "ai_jobs_max_attempts_check" CHECK ("ai_jobs"."max_attempts" between 1 and 10),
	CONSTRAINT "ai_jobs_attempt_bound_check" CHECK ("ai_jobs"."attempts" <= "ai_jobs"."max_attempts"),
	CONSTRAINT "ai_jobs_status_check" CHECK ("ai_jobs"."status" in ('queued', 'leased', 'succeeded', 'dead', 'canceled')),
	CONSTRAINT "ai_jobs_lease_shape_check" CHECK (("ai_jobs"."status" = 'leased' and "ai_jobs"."lease_owner" is not null and "ai_jobs"."lease_expires_at" is not null) or ("ai_jobs"."status" <> 'leased'))
);
--> statement-breakpoint
CREATE TABLE "ai_run_events" (
	"run_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_run_events_run_sequence_pk" PRIMARY KEY("run_id","sequence"),
	CONSTRAINT "ai_run_events_sequence_check" CHECK ("ai_run_events"."sequence" > 0),
	CONSTRAINT "ai_run_events_type_length_check" CHECK (char_length("ai_run_events"."type") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"document_generation_id" uuid NOT NULL,
	"base_durable_sequence" bigint NOT NULL,
	"selection_hash" text NOT NULL,
	"idempotency_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"execution_input" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"skill_id" text NOT NULL,
	"skill_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"provider" text DEFAULT 'google-gemini' NOT NULL,
	"model" text DEFAULT 'gemini-3.5-flash' NOT NULL,
	"sdk_version" text NOT NULL,
	"config_version" text NOT NULL,
	"last_event_sequence" bigint DEFAULT 0 NOT NULL,
	"provider_interaction_id" text,
	"response_hash" text,
	"proposal" jsonb,
	"proposal_hash" text,
	"proposal_risk_class" text,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"safe_error" jsonb,
	"cancel_requested_at" timestamp with time zone,
	"deadline_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_runs_base_sequence_check" CHECK ("ai_runs"."base_durable_sequence" >= 0),
	CONSTRAINT "ai_runs_last_event_sequence_check" CHECK ("ai_runs"."last_event_sequence" >= 0),
	CONSTRAINT "ai_runs_selection_hash_check" CHECK (char_length("ai_runs"."selection_hash") = 64),
	CONSTRAINT "ai_runs_idempotency_hash_check" CHECK (char_length("ai_runs"."idempotency_hash") = 64),
	CONSTRAINT "ai_runs_input_hash_check" CHECK (char_length("ai_runs"."input_hash") = 64),
	CONSTRAINT "ai_runs_status_check" CHECK ("ai_runs"."status" in ('queued', 'preparing_context', 'calling_model', 'building_proposal', 'validating_proposal', 'waiting_for_approval', 'applying', 'completed', 'canceled', 'policy_denied', 'provider_unavailable', 'budget_exceeded', 'validation_failed', 'stale_generation', 'expired_approval')),
	CONSTRAINT "ai_runs_provider_check" CHECK ("ai_runs"."provider" = 'google-gemini'),
	CONSTRAINT "ai_runs_model_check" CHECK ("ai_runs"."model" = 'gemini-3.5-flash'),
	CONSTRAINT "ai_runs_hashes_check" CHECK (("ai_runs"."response_hash" is null or char_length("ai_runs"."response_hash") = 64) and ("ai_runs"."proposal_hash" is null or char_length("ai_runs"."proposal_hash") = 64)),
	CONSTRAINT "ai_runs_deadline_check" CHECK ("ai_runs"."deadline_at" > "ai_runs"."created_at")
);
--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_run_events" ADD CONSTRAINT "ai_run_events_run_id_ai_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_jobs_run_unique" ON "ai_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "ai_jobs_claim_idx" ON "ai_jobs" USING btree ("status","available_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "ai_run_events_created_idx" ON "ai_run_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_runs_principal_idempotency_unique" ON "ai_runs" USING btree ("principal_id","idempotency_hash");--> statement-breakpoint
CREATE INDEX "ai_runs_principal_created_idx" ON "ai_runs" USING btree ("principal_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_board_created_idx" ON "ai_runs" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_runs_status_updated_idx" ON "ai_runs" USING btree ("status","updated_at");