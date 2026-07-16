CREATE TABLE "board_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"name" text NOT NULL,
	"document" jsonb NOT NULL,
	"source_document_generation_id" uuid NOT NULL,
	"source_revision" bigint NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_checkpoints_name_length_check" CHECK (char_length("board_checkpoints"."name") between 1 and 80),
	CONSTRAINT "board_checkpoints_document_object_check" CHECK (jsonb_typeof("board_checkpoints"."document") = 'object'),
	CONSTRAINT "board_checkpoints_source_revision_check" CHECK ("board_checkpoints"."source_revision" >= 0)
);
--> statement-breakpoint
ALTER TABLE "board_checkpoints" ADD CONSTRAINT "board_checkpoints_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_checkpoints" ADD CONSTRAINT "board_checkpoints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_checkpoints_board_created_idx" ON "board_checkpoints" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "board_checkpoints_board_name_idx" ON "board_checkpoints" USING btree ("board_id","name");--> statement-breakpoint
CREATE INDEX "board_checkpoints_creator_created_idx" ON "board_checkpoints" USING btree ("created_by","created_at");
