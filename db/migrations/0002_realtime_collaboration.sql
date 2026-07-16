CREATE TABLE "realtime_document_heads" (
	"board_id" uuid NOT NULL,
	"document_generation_id" uuid NOT NULL,
	"last_sequence" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_document_heads_board_generation_pk" PRIMARY KEY("board_id","document_generation_id"),
	CONSTRAINT "realtime_document_heads_sequence_check" CHECK ("realtime_document_heads"."last_sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "realtime_security_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"principal_id" uuid,
	"board_id" uuid,
	"document_generation_id" uuid,
	"message_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_security_events_code_length_check" CHECK (char_length("realtime_security_events"."code") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "realtime_ticket_mint_windows" (
	"principal_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_ticket_mint_windows_principal_board_window_pk" PRIMARY KEY("principal_id","board_id","window_started_at"),
	CONSTRAINT "realtime_ticket_mint_windows_count_check" CHECK ("realtime_ticket_mint_windows"."count" > 0)
);
--> statement-breakpoint
CREATE TABLE "realtime_ticket_redemptions" (
	"ticket_hmac" text PRIMARY KEY NOT NULL,
	"principal_id" uuid NOT NULL,
	"board_id" uuid NOT NULL,
	"document_generation_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_ticket_redemptions_hmac_check" CHECK (char_length("realtime_ticket_redemptions"."ticket_hmac") = 64),
	CONSTRAINT "realtime_ticket_redemptions_expiry_check" CHECK ("realtime_ticket_redemptions"."expires_at" > "realtime_ticket_redemptions"."redeemed_at")
);
--> statement-breakpoint
CREATE TABLE "realtime_updates" (
	"board_id" uuid NOT NULL,
	"document_generation_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"message_id" uuid NOT NULL,
	"client_instance_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"payload" bytea NOT NULL,
	"payload_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "realtime_updates_board_generation_sequence_pk" PRIMARY KEY("board_id","document_generation_id","sequence"),
	CONSTRAINT "realtime_updates_sequence_check" CHECK ("realtime_updates"."sequence" > 0),
	CONSTRAINT "realtime_updates_payload_size_check" CHECK (octet_length("realtime_updates"."payload") between 1 and 262144),
	CONSTRAINT "realtime_updates_payload_hash_check" CHECK (char_length("realtime_updates"."payload_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "realtime_document_heads" ADD CONSTRAINT "realtime_document_heads_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_security_events" ADD CONSTRAINT "realtime_security_events_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_security_events" ADD CONSTRAINT "realtime_security_events_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_ticket_mint_windows" ADD CONSTRAINT "realtime_ticket_mint_windows_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_ticket_mint_windows" ADD CONSTRAINT "realtime_ticket_mint_windows_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_ticket_redemptions" ADD CONSTRAINT "realtime_ticket_redemptions_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_ticket_redemptions" ADD CONSTRAINT "realtime_ticket_redemptions_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_updates" ADD CONSTRAINT "realtime_updates_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_updates" ADD CONSTRAINT "realtime_updates_principal_id_users_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "realtime_security_events_code_created_idx" ON "realtime_security_events" USING btree ("code","created_at");--> statement-breakpoint
CREATE INDEX "realtime_security_events_board_created_idx" ON "realtime_security_events" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "realtime_ticket_mint_windows_expiry_idx" ON "realtime_ticket_mint_windows" USING btree ("window_started_at");--> statement-breakpoint
CREATE INDEX "realtime_ticket_redemptions_expiry_idx" ON "realtime_ticket_redemptions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_updates_message_id_unique" ON "realtime_updates" USING btree ("board_id","document_generation_id","message_id");--> statement-breakpoint
CREATE INDEX "realtime_updates_replay_idx" ON "realtime_updates" USING btree ("board_id","document_generation_id","sequence");
