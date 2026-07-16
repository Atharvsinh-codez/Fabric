CREATE TABLE "avatar_upload_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"content_hash" text NOT NULL,
	"r2_object_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatar_upload_reservations_mime_type_check" CHECK ("avatar_upload_reservations"."mime_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "avatar_upload_reservations_byte_size_check" CHECK ("avatar_upload_reservations"."byte_size" between 1 and 5242880),
	CONSTRAINT "avatar_upload_reservations_content_hash_check" CHECK ("avatar_upload_reservations"."content_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "avatar_upload_reservations_status_check" CHECK ("avatar_upload_reservations"."status" in ('pending', 'completed', 'rejected', 'expired')),
	CONSTRAINT "avatar_upload_reservations_expiry_check" CHECK ("avatar_upload_reservations"."expires_at" > "avatar_upload_reservations"."created_at"),
	CONSTRAINT "avatar_upload_reservations_completion_check" CHECK (("avatar_upload_reservations"."status" = 'completed' and "avatar_upload_reservations"."completed_at" is not null)
        or ("avatar_upload_reservations"."status" <> 'completed' and "avatar_upload_reservations"."completed_at" is null)),
	CONSTRAINT "avatar_upload_reservations_r2_object_key_check" CHECK (char_length("avatar_upload_reservations"."r2_object_key") between 1 and 900
        and "avatar_upload_reservations"."r2_object_key" !~ '(^/|\\|(^|/)\.{1,2}(/|$)|//)')
);
--> statement-breakpoint
ALTER TABLE "avatar_upload_reservations" ADD CONSTRAINT "avatar_upload_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "avatar_upload_reservations_r2_object_key_unique" ON "avatar_upload_reservations" USING btree ("r2_object_key");--> statement-breakpoint
CREATE INDEX "avatar_upload_reservations_user_status_expiry_idx" ON "avatar_upload_reservations" USING btree ("user_id","status","expires_at");