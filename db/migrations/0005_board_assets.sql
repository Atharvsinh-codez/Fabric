CREATE TABLE "board_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid NOT NULL,
	"tldraw_asset_id" text NOT NULL,
	"mime_type" text NOT NULL,
	"original_name" text,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"content" "bytea" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_assets_tldraw_id_check" CHECK ("board_assets"."tldraw_asset_id" ~ '^asset:[A-Za-z0-9_-]{1,180}$'),
	CONSTRAINT "board_assets_mime_type_check" CHECK ("board_assets"."mime_type" in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
	CONSTRAINT "board_assets_original_name_check" CHECK ("board_assets"."original_name" is null or char_length("board_assets"."original_name") between 1 and 180),
	CONSTRAINT "board_assets_byte_size_check" CHECK ("board_assets"."byte_size" between 1 and 5242880),
	CONSTRAINT "board_assets_content_hash_check" CHECK ("board_assets"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "board_assets_content_size_check" CHECK (octet_length("board_assets"."content") = "board_assets"."byte_size")
);
--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_assets" ADD CONSTRAINT "board_assets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_assets_board_tldraw_id_unique" ON "board_assets" USING btree ("board_id","tldraw_asset_id");--> statement-breakpoint
CREATE INDEX "board_assets_board_created_idx" ON "board_assets" USING btree ("board_id","created_at");--> statement-breakpoint
CREATE INDEX "board_assets_uploader_created_idx" ON "board_assets" USING btree ("uploaded_by","created_at");